const {DatabaseSync} = require('node:sqlite');
const db = new DatabaseSync('data/useful-waiting.sqlite');
db.prepare("UPDATE jobs SET funding_status='paid' WHERE funding_status='payable'").run();
db.prepare("UPDATE proofs SET funding_status='paid', tx_hash='0xMockTx123', explorer_url='https://testnet.arcscan.io/tx/0xMockTx123', settlement_status='Paid · Settled on Arc Testnet' WHERE funding_status='payable'").run();
console.log('Mock settlement successful! UI should reflect it.');
