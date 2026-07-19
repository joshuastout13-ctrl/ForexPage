import { getMyfxbookLive } from './lib/myfxbook.js';

async function run() {
  console.log('Manually triggering Myfxbook live data fetch...');
  try {
    const data = await getMyfxbookLive();
    console.log('Successfully fetched and merged data:');
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error during data fetch:', error.message);
  }
}

run();
