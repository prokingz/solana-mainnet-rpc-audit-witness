import https from 'node:https';
import fs from 'node:fs';

const targets = [
  { id: 2, pubkey: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2' },
  { id: 3, pubkey: 'DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz' },
  { id: 4, pubkey: 'HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz' },
  { id: 5, pubkey: '11C17zj2S6Usbnqcqbv1e1Bvyh2TT3FM18n5fCL5ZEe' },
  { id: 6, pubkey: '2KTJHKNHsqrnCdxkkpvDy4oBhkfGXGE4ryVyNvWuAkJD' },
  { id: 7, pubkey: '4m8BxVRp1SBFtbrPbqbzJTqWhfb2Xi4SUgSjdjRKGZWw' }
];

function fetchRpc(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.mainnet-beta.solana.com',
      port: 443,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'SolanaMainnetCloudWitness/1.0 (GitHubActions-NeutralRunner)'
      }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('Querying getGenesisHash...');
  const genesis = await fetchRpc({ jsonrpc: '2.0', id: 1, method: 'getGenesisHash', params: [] });
  console.log('Genesis Hash:', genesis.result);
  await sleep(400);

  const results = [genesis];
  for (const t of targets) {
    console.log(`Querying account ${t.pubkey}...`);
    const acc = await fetchRpc({
      jsonrpc: '2.0',
      id: t.id,
      method: 'getAccountInfo',
      params: [t.pubkey, { encoding: 'base64', commitment: 'confirmed' }]
    });
    console.log(`ID ${t.id} -> slot: ${acc.result?.context?.slot}`);
    results.push(acc);
    await sleep(400);
  }

  fs.writeFileSync('LIVE_MAINNET_CLOUD_WITNESS.json', JSON.stringify(results, null, 2), 'utf-8');
  console.log('Successfully wrote LIVE_MAINNET_CLOUD_WITNESS.json');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
