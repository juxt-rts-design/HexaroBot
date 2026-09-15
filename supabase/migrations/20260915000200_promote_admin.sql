-- Force le compte ADMIN_EMAIL en admin (à adapter si besoin)
UPDATE public.profiles
SET role = 'admin'
WHERE lower(email) = lower('hexaro@gmail.com');

-- Re-applique les droits si "permission denied for schema public" revient
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
