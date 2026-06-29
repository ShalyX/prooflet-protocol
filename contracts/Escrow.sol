// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ProofletEscrow
 * @notice Holds Arc Testnet USDC for externally funded agent jobs.
 *         Issuer deposits → escrow holds → operator releases to agent on approved proof.
 *
 * Architecture:
 *   - Issuer calls deposit(jobId, agent, amount) with USDC approval
 *   - Only settlementOperator can release() or refund()
 *   - Events emitted for full off-chain indexing
 */
interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    uint256 private _status;

    constructor() {
        _status = _NOT_ENTERED;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

contract ProofletEscrow is ReentrancyGuard {
    // Arc Testnet USDC: 0x3600000000000000000000000000000000000000
    IERC20 public immutable usdc;

    address public settlementOperator;

    enum EscrowStatus { None, Funded, Released, Refunded }

    struct Escrow {
        bytes32 jobId;
        address issuer;
        address agent;
        uint256 amount;
        EscrowStatus status;
        uint256 fundedAt;
    }

    mapping(bytes32 => Escrow) public escrows;

    event Deposited(
        bytes32 indexed jobId,
        address indexed issuer,
        address indexed agent,
        uint256 amount,
        uint256 timestamp
    );
    event Released(
        bytes32 indexed jobId,
        address indexed agent,
        uint256 amount,
        uint256 timestamp
    );
    event Refunded(
        bytes32 indexed jobId,
        address indexed issuer,
        uint256 amount,
        uint256 timestamp
    );

    modifier onlyOperator() {
        require(msg.sender == settlementOperator, "ProofletEscrow: only settlement operator");
        _;
    }

    modifier jobExists(bytes32 jobId) {
        require(escrows[jobId].issuer != address(0), "ProofletEscrow: job does not exist");
        _;
    }

    constructor(address _usdc, address _operator) {
        require(_usdc != address(0), "ProofletEscrow: zero USDC address");
        require(_operator != address(0), "ProofletEscrow: zero operator address");
        usdc = IERC20(_usdc);
        settlementOperator = _operator;
    }

    /**
     * @notice Deposit USDC into escrow for a specific job.
     * @dev Caller must approve USDC transfer to this contract first.
     * @param jobId    The Prooflet job ID (converted to bytes32)
     * @param agent    The agent address who will receive payment on release
     * @param amount   USDC amount (in smallest unit, 6 decimals)
     */
    function deposit(bytes32 jobId, address agent, uint256 amount) external nonReentrant {
        require(agent != address(0), "ProofletEscrow: zero agent address");
        require(amount > 0, "ProofletEscrow: zero amount");
        require(
            escrows[jobId].status == EscrowStatus.None ||
            escrows[jobId].status == EscrowStatus.Refunded,
            "ProofletEscrow: job already funded"
        );

        bool ok = usdc.transferFrom(msg.sender, address(this), amount);
        require(ok, "ProofletEscrow: USDC transferFrom failed");

        escrows[jobId] = Escrow({
            jobId: jobId,
            issuer: msg.sender,
            agent: agent,
            amount: amount,
            status: EscrowStatus.Funded,
            fundedAt: block.timestamp
        });

        emit Deposited(jobId, msg.sender, agent, amount, block.timestamp);
    }

    /**
     * @notice Release escrowed USDC to the agent. Called by settlement operator
     *         after proof is approved.
     */
    function release(bytes32 jobId) external onlyOperator jobExists(jobId) nonReentrant {
        Escrow storage escrow = escrows[jobId];
        require(escrow.status == EscrowStatus.Funded, "ProofletEscrow: not in funded state");

        escrow.status = EscrowStatus.Released;
        bool ok = usdc.transfer(escrow.agent, escrow.amount);
        require(ok, "ProofletEscrow: USDC transfer failed");

        emit Released(jobId, escrow.agent, escrow.amount, block.timestamp);
    }

    /**
     * @notice Refund escrowed USDC to the issuer. Called by settlement operator
     *         when proof is rejected or job is cancelled.
     */
    function refund(bytes32 jobId) external onlyOperator jobExists(jobId) nonReentrant {
        Escrow storage escrow = escrows[jobId];
        require(escrow.status == EscrowStatus.Funded, "ProofletEscrow: not in funded state");

        escrow.status = EscrowStatus.Refunded;
        bool ok = usdc.transfer(escrow.issuer, escrow.amount);
        require(ok, "ProofletEscrow: USDC transfer failed");

        emit Refunded(jobId, escrow.issuer, escrow.amount, block.timestamp);
    }

    /**
     * @notice View escrow status by job ID.
     */
    function getEscrow(bytes32 jobId) external view returns (Escrow memory) {
        return escrows[jobId];
    }

    /**
     * @notice Allow operator to transfer ownership to a new operator address.
     */
    function transferOperator(address newOperator) external onlyOperator {
        require(newOperator != address(0), "ProofletEscrow: zero operator address");
        settlementOperator = newOperator;
    }
}
