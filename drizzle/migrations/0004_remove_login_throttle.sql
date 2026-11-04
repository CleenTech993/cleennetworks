-- Removes the temporary sign-in lockout that blocked an account after five
-- wrong passwords. Failed attempts are still recorded (server-side only) so
-- repeated-failure and new-location security alerts keep working.
DROP FUNCTION IF EXISTS public.check_auth_login_throttle(text, text) CASCADE;
