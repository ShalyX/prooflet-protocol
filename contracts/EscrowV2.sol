// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ProofletEscrowV2
 * @notice Open-marketplace escrow for Arc Testnet USDC.
 *         Issuer funds a job before any agent is known; operator releases to the
 *         approved agent after Prooflet verification, or refunds on reject/expiry.
 *
 * Post-submission development — not part of the original Lepton submission.
 *
 * V1 limitation fixed: deposit no longer requires agent address at fund time.
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

contract ProofletEscrowV2 is ReentrancyGuard {
    IERC20 public immutable usdc;
    address public settlementOperator;

    enum EscrowStatus { None, Funded, Released, Refunded }

    struct Escrow {
        bytes32 jobId;
        address issuer;
        address agent; // address(0) until release
        uint256 amount;
        uint256 expiresAt;
        EscrowStatus status;
        uint256 fundedAt;
    }

    mapping(bytes32 => Escrow) public escrows;

    event JobFunded(
        bytes32 indexed jobId,
        address indexed issuer,
        uint256 amount,
        uint256 expiresAt,
        uint256 timestamp
    );
    event Released(
        bytes32 indexed jobId,
        address indexed agent,
        bytes32 proofId,
        uint256 amount,
        uint256 timestamp
    );
    event Refunded(
        bytes32 indexed jobId,
        address indexed issuer,
        uint256 amount,
        uint256 timestamp
    );
    event OperatorTransferred(address indexed previousOperator, address indexed newOperator);

    modifier onlyOperator() {
        require(msg.sender == settlementOperator, "ProofletEscrowV2: only settlement operator");
        _;
    }

    modifier jobFunded(bytes32 jobId) {
        require(escrows[jobId].status == EscrowStatus.Funded, "ProofletEscrowV2: job not funded");
        _;
    }

    constructor(address _usdc, address _operator) {
        require(_usdc != address(0), "ProofletEscrowV2: zero USDC address");
        require(_operator != address(0), "ProofletEscrowV2: zero operator address");
        usdc = IERC20(_usdc);
        settlementOperator = _operator;
    }

    /**
     * @notice Fund a marketplace job before an agent is known.
     * @dev Caller must approve USDC to this contract first.
     */
    function fundJob(bytes32 jobId, uint256 amount, uint256 expiresAt) external nonReentrant {
        require(amount > 0, "ProofletEscrowV2: zero amount");
        require(expiresAt > block.timestamp, "ProofletEscrowV2: expiresAt must be future");
        require(
            escrows[jobId].status == EscrowStatus.None || escrows[jobId].status == EscrowStatus.Refunded,
            "ProofletEscrowV2: job already funded"
        );

        bool ok = usdc.transferFrom(msg.sender, address(this), amount);
        require(ok, "ProofletEscrowV2: USDC transferFrom failed");

        escrows[jobId] = Escrow({
            jobId: jobId,
            issuer: msg.sender,
            agent: address(0),
            amount: amount,
            expiresAt: expiresAt,
            status: EscrowStatus.Funded,
            fundedAt: block.timestamp
        });

        emit JobFunded(jobId, msg.sender, amount, expiresAt, block.timestamp);
    }

    /**
     * @notice Release full escrowed amount to the approved agent after proof approval.
     * @dev Operator-controlled; amount must match the funded escrow amount.
     */
    function release(bytes32 jobId, bytes32 proofId, address agent, uint256 amount)
        external
        onlyOperator
        jobFunded(jobId)
        nonReentrant
    {
        require(agent != address(0), "ProofletEscrowV2: zero agent address");
        Escrow storage escrow = escrows[jobId];
        require(amount == escrow.amount, "ProofletEscrowV2: amount mismatch");
        require(block.timestamp <= escrow.expiresAt, "ProofletEscrowV2: job expired");

        escrow.status = EscrowStatus.Released;
        escrow.agent = agent;

        bool ok = usdc.transfer(agent, amount);
        require(ok, "ProofletEscrowV2: USDC transfer failed");

        emit Released(jobId, agent, proofId, amount, block.timestamp);
    }

    /**
     * @notice Refund funded escrow to issuer (reject/cancel path). Operator only.
     */
    function refundJob(bytes32 jobId) external onlyOperator jobFunded(jobId) nonReentrant {
        Escrow storage escrow = escrows[jobId];
        escrow.status = EscrowStatus.Refunded;
        bool ok = usdc.transfer(escrow.issuer, escrow.amount);
        require(ok, "ProofletEscrowV2: USDC transfer failed");
        emit Refunded(jobId, escrow.issuer, escrow.amount, block.timestamp);
    }

    /**
     * @notice Issuer may reclaim funds after expiresAt if still funded.
     */
    function refundExpired(bytes32 jobId) external jobFunded(jobId) nonReentrant {
        Escrow storage escrow = escrows[jobId];
        require(msg.sender == escrow.issuer, "ProofletEscrowV2: only issuer");
        require(block.timestamp > escrow.expiresAt, "ProofletEscrowV2: not expired");

        escrow.status = EscrowStatus.Refunded;
        bool ok = usdc.transfer(escrow.issuer, escrow.amount);
        require(ok, "ProofletEscrowV2: USDC transfer failed");
        emit Refunded(jobId, escrow.issuer, escrow.amount, block.timestamp);
    }

    function getEscrow(bytes32 jobId) external view returns (Escrow memory) {
        return escrows[jobId];
    }

    function transferOperator(address newOperator) external onlyOperator {
        require(newOperator != address(0), "ProofletEscrowV2: zero operator address");
        address previous = settlementOperator;
        settlementOperator = newOperator;
        emit OperatorTransferred(previous, newOperator);
    }
}
