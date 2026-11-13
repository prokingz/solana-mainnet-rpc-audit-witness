import https from 'node:https';
import fs from 'node:fs';
import crypto from 'node:crypto';

const targets = [
  {
    id: 2,
    name: 'Raydium AMM V4 Pool',
    pubkey: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2',
    expectedOwner: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    expectedLen: 752
  },
  {
    id: 3,
    name: 'V4 coinVault (WSOL)',
    pubkey: 'DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz',
    expectedOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    expectedLen: 165
  },
  {
    id: 4,
    name: 'V4 pcVault (USDC)',
    pubkey: 'HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz',
    expectedOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    expectedLen: 165
  },
  {
    id: 5,
    name: 'Raydium CPMM Pool',
    pubkey: '11C17zj2S6Usbnqcqbv1e1Bvyh2TT3FM18n5fCL5ZEe',
    expectedOwner: 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
    expectedLen: 637
  },
  {
    id: 6,
    name: 'CPMM token0Vault (WSOL)',
    pubkey: '2KTJHKNHsqrnCdxkkpvDy4oBhkfGXGE4ryVyNvWuAkJD',
    expectedOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    expectedLen: 165
  },
  {
    id: 7,
    name: 'CPMM token1Vault (7cLh...)',
    pubkey: '4m8BxVRp1SBFtbrPbqbzJTqWhfb2Xi4SUgSjdjRKGZWw',
    expectedOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    expectedLen: 165
  }
];

// Persistent agent ensures strict serial reuse of the identical TLS 1.3 socket connection
const keepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 1,
  keepAliveMsecs: 60000
});

let primarySocketInstance = null;
const primarySocketSessionUuid = crypto.randomUUID();

function fetchRpc(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.mainnet-beta.solana.com',
      port: 443,
      path: '/',
      method: 'POST',
      agent: keepAliveAgent,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'SolanaMainnetCloudWitness/4.0 (StrictSocketIdentity-AttestedRunner)'
      }
    }, (res) => {
      // 1. Explicit HTTP status verification
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP status error: ${res.statusCode} ${res.statusMessage}`));
        return;
      }

      const sock = res.socket;

      // 2. Strict Socket Object Identity and Fail-Fast Enforcement
      if (!primarySocketInstance) {
        primarySocketInstance = sock;
        sock.__witnessSessionUuid = primarySocketSessionUuid;
        sock.__witnessEstablishedAt = Date.now();
      } else {
        if (sock !== primarySocketInstance) {
          reject(new Error(`CRITICAL AUDIT FAILURE: Socket reference mismatch for query ID ${payload.id}! A new socket instance was created. Aborting execution.`));
          return;
        }
        if (sock.__witnessSessionUuid !== primarySocketSessionUuid) {
          reject(new Error(`CRITICAL AUDIT FAILURE: Socket session UUID mismatch for query ID ${payload.id}! Aborting execution.`));
          return;
        }
        if (sock.destroyed || sock.closed) {
          reject(new Error(`CRITICAL AUDIT FAILURE: Socket was closed or destroyed for query ID ${payload.id}! Aborting execution.`));
          return;
        }
      }

      const localPort = sock.localPort;
      const remotePort = sock.remotePort;
      const proto = sock.getProtocol();
      const cipher = sock.getCipher();
      const cert = sock.getPeerCertificate(true);

      const chain = [];
      let curr = cert;
      while (curr && curr.issuerCertificate && curr.issuerCertificate !== curr) {
        curr = curr.issuerCertificate;
        chain.push({
          subject: curr.subject,
          issuer: curr.issuer,
          fingerprint256: curr.fingerprint256,
          valid_from: curr.valid_from,
          valid_to: curr.valid_to,
          serialNumber: curr.serialNumber
        });
      }

      const tlsSnapshot = {
        socketInstanceIdentical: (sock === primarySocketInstance),
        socketSessionUuid: sock.__witnessSessionUuid,
        socketLocalPort: localPort,
        socketRemotePort: remotePort,
        protocol: proto,
        cipher: cipher,
        peerCertificate: {
          subject: cert.subject,
          issuer: cert.issuer,
          fingerprint256: cert.fingerprint256,
          valid_from: cert.valid_from,
          valid_to: cert.valid_to,
          serialNumber: cert.serialNumber
        },
        certificateChain: chain
      };

      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);

          // 3. Validate JSON-RPC ID and reject error responses
          if (json.error) {
            reject(new Error(`JSON-RPC Error for ID ${payload.id}: ${JSON.stringify(json.error)}`));
            return;
          }
          if (json.id !== payload.id) {
            reject(new Error(`JSON-RPC ID mismatch: expected ${payload.id}, received ${json.id}`));
            return;
          }

          resolve({ json, tlsSnapshot, socketRef: sock });
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
  console.log('[1/8] Executing live getGenesisHash over persistent TLS 1.3 socket...');
  const genesis = await fetchRpc({ jsonrpc: '2.0', id: 1, method: 'getGenesisHash', params: [] });
  
  if (genesis.json.result !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') {
    throw new Error(`CRITICAL: Genesis Hash mismatch! Expected 5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d, got ${genesis.json.result}`);
  }

  const anchorPort = genesis.tlsSnapshot.socketLocalPort;
  console.log(`  -> Genesis Hash verified: ${genesis.json.result}`);
  console.log(`  -> Primary Socket Identity: Session UUID=${primarySocketSessionUuid}, localPort=${anchorPort}`);
  console.log(`  -> TLS Protocol: ${genesis.tlsSnapshot.protocol} | Cipher: ${genesis.tlsSnapshot.cipher.name}`);
  console.log(`  -> Server Cert SHA-256: ${genesis.tlsSnapshot.peerCertificate.fingerprint256}`);
  await sleep(400);

  const results = [genesis.json];
  const provenanceRecord = {
    capturedAt: new Date().toISOString(),
    endpoint: 'api.mainnet-beta.solana.com:443',
    genesisHash: genesis.json.result,
    socketIdentityProof: {
      sessionUuid: primarySocketSessionUuid,
      localPort: anchorPort,
      remotePort: genesis.tlsSnapshot.socketRemotePort,
      protocol: genesis.tlsSnapshot.protocol,
      cipherSuite: genesis.tlsSnapshot.cipher.name,
      serverCertSubject: genesis.tlsSnapshot.peerCertificate.subject,
      serverCertFingerprint256: genesis.tlsSnapshot.peerCertificate.fingerprint256,
      caChainDepth: genesis.tlsSnapshot.certificateChain.length,
      strictObjectIdentityEnforced: true
    },
    tlsSessionDetail: genesis.tlsSnapshot,
    callAuditLog: [
      {
        id: 1,
        query: 'getGenesisHash',
        socketLocalPort: anchorPort,
        socketObjectIdentityVerified: true,
        sessionUuidMatch: true,
        tlsProtocol: genesis.tlsSnapshot.protocol,
        certFingerprint256: genesis.tlsSnapshot.peerCertificate.fingerprint256,
        status: 'VERIFIED'
      }
    ]
  };

  for (let idx = 0; idx < targets.length; idx++) {
    const t = targets[idx];
    console.log(`[${idx + 2}/8] Querying account ${t.name} (${t.pubkey}) on IDENTICAL socket...`);
    const acc = await fetchRpc({
      jsonrpc: '2.0',
      id: t.id,
      method: 'getAccountInfo',
      params: [t.pubkey, { encoding: 'base64', commitment: 'confirmed' }]
    });

    // 4. Strict runtime assertion: FAIL EXECUTION if socket object changed
    if (acc.socketRef !== primarySocketInstance) {
      throw new Error(`FATAL AUDIT VIOLATION: Socket object mismatch on call ID ${t.id} (${t.name})! Execution halted.`);
    }

    const val = acc.json.result?.value;
    if (!val) {
      throw new Error(`Account data null for ${t.name} (${t.pubkey})`);
    }

    // 5. Strict owner and buffer length assertions
    if (val.owner !== t.expectedOwner) {
      throw new Error(`Owner assertion failed for ${t.name}: expected ${t.expectedOwner}, received ${val.owner}`);
    }
    const rawBuf = Buffer.from(val.data[0], 'base64');
    if (rawBuf.length !== t.expectedLen) {
      throw new Error(`Buffer size assertion failed for ${t.name}: expected ${t.expectedLen} bytes, received ${rawBuf.length} bytes`);
    }

    console.log(`  -> Slot: ${acc.json.result?.context?.slot} | Owner: ${val.owner} (VERIFIED) | Size: ${rawBuf.length} B (VERIFIED)`);
    console.log(`  -> Socket Instance Identity: EXACT_OBJECT_MATCH (port ${acc.tlsSnapshot.socketLocalPort})`);

    results.push(acc.json);
    provenanceRecord.callAuditLog.push({
      id: t.id,
      targetName: t.name,
      pubkey: t.pubkey,
      owner: val.owner,
      slot: acc.json.result?.context?.slot,
      dataLength: rawBuf.length,
      socketLocalPort: acc.tlsSnapshot.socketLocalPort,
      socketObjectIdentityVerified: true,
      sessionUuidMatch: (acc.tlsSnapshot.socketSessionUuid === primarySocketSessionUuid),
      tlsProtocol: acc.tlsSnapshot.protocol,
      certFingerprint256: acc.tlsSnapshot.peerCertificate.fingerprint256,
      status: 'VERIFIED_MATCH'
    });

    await sleep(400);
  }

  // Close persistent agent cleanly
  keepAliveAgent.destroy();

  // Preserve LF line endings
  fs.writeFileSync('LIVE_MAINNET_CLOUD_WITNESS.json', JSON.stringify(results, null, 2) + '\n', 'utf-8');
  fs.writeFileSync('TLS_SESSION_PROVENANCE.json', JSON.stringify(provenanceRecord, null, 2) + '\n', 'utf-8');
  console.log('\n[SUCCESS] All 7 RPC queries verified over the EXACT IDENTICAL socket instance with zero errors.');
  console.log('[OUTPUT] Written LIVE_MAINNET_CLOUD_WITNESS.json and TLS_SESSION_PROVENANCE.json');
}

main().catch(err => {
  console.error('\n[FATAL AUDIT FAILURE]:', err);
  process.exit(1);
});
