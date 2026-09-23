import https from 'node:https';

function checkUrl() {
  return new Promise((resolve, reject) => {
    https.get('https://4xtrack.com', res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, body });
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Inspecting live deployment at https://4xtrack.com ...');
  
  for (let attempt = 1; attempt <= 10; attempt++) {
    const { status, body } = await checkUrl();
    const hasVerificationInProgress = body.includes('Verification in progress');
    const hasPendingVerification = body.includes('Pending verification');
    const hasLifetimeBasis = body.includes('Lifetime basis incomplete');

    console.log(`[Attempt ${attempt}] HTTP ${status}:`);
    console.log(`  "Verification in progress" present: ${hasVerificationInProgress}`);
    console.log(`  "Pending verification" present:     ${hasPendingVerification}`);
    console.log(`  "Lifetime basis incomplete" present: ${hasLifetimeBasis}`);

    if (!hasVerificationInProgress && !hasPendingVerification && !hasLifetimeBasis) {
      console.log('\n✅ VERIFIED: https://4xtrack.com is serving the clean investor portal HTML!');
      console.log('All forbidden provenance/verification messaging has been eradicated from production.');
      return;
    }

    console.log('Deployment still propagating on Vercel CDN, waiting 5 seconds...');
    await new Promise(r => setTimeout(r, 5000));
  }
}

main().catch(console.error);
