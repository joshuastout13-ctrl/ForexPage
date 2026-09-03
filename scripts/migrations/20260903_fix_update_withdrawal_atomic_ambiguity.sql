-- =============================================================================
-- Migration: Fix PostgreSQL RPC Overload Ambiguity for update_withdrawal_atomic
-- Target: Supabase PostgreSQL (public schema)
-- Date: 2026-09-03
--
-- Issue:
-- Two overloads exist in public schema:
--   1. update_withdrawal_atomic(p_withdrawal_id => text, ...)
--   2. update_withdrawal_atomic(p_withdrawal_id => uuid, ...)
-- PostgREST cannot choose between text and uuid when parameters are passed as JSON strings,
-- resulting in PostgreSQL error 42725 (ambiguous function call).
--
-- Solution:
-- Drop the obsolete UUID signature. The canonical withdrawal table primary key
-- is TEXT (e.g. 'wd_e4fc9d89', 'wd_54f99320'). Preserve the TEXT signature.
-- =============================================================================

-- 1. Drop the obsolete UUID overload
DROP FUNCTION IF EXISTS public.update_withdrawal_atomic(UUID, NUMERIC, TEXT, TEXT, TEXT);

-- 2. Ensure permissions and search path on the canonical TEXT signature
REVOKE EXECUTE ON FUNCTION public.update_withdrawal_atomic(TEXT, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_withdrawal_atomic(TEXT, NUMERIC, TEXT, TEXT, TEXT) TO service_role;
