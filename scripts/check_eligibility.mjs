process.env.DATA_SOURCE = 'supabase';
import { supabase } from '../lib/supabase.js';

async function getEligibility() {
  const recipientIds = [
    'inv_4d52f6a4', // David Townley
    'stout001',     // Joshua Stout
    'inv_015f3774', // Stone & Co Owners
    'inv_920b8af8', // Ross Wamsley
    'inv_e1d4f2af', // Josh Richards
    'inv_d0f857c7', // Jacob Wamsley
    'inv_df9fbf05', // David Valdes
    'inv_d2ab6da4', // Michael Beck
    'inv_a79798ca', // Ted Boardwalk
    'inv_d3ec0cf8', // Adam Richards
    'inv_57a1a49a', // Bill and Mary Kimball
    'inv_6a1b838a', // Val Taylor
    'inv_a7e429ce', // Jim Colby
    'inv_141417dc'  // Nelson Guyer
  ];

  const { data: shares } = await supabase.from('commission_shares').select('*').in('recipient_investor_id', recipientIds);

  for (const id of recipientIds) {
    const userShares = (shares || []).filter(s => s.recipient_investor_id === id);
    const activeShares = userShares.filter(s => s.status === 'active');
    
    // Check effective date ranges in August 2026
    const augActive = activeShares.filter(s => {
      const start = s.effective_start_date || '2000-01-01';
      const end = s.effective_end_date || '9999-12-31';
      return start <= '2026-08-31' && end >= '2026-08-01';
    });

    console.log(`Recipient: ${id} | Total Shares: ${userShares.length} | Active: ${activeShares.length} | Aug-Eligible Active: ${augActive.length}`);
  }
}

getEligibility().catch(console.error);
