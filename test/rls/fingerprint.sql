-- Otisak strukture baze (public): isti upit nad dve baze, pa diff. Redosled kolona/objekata je normalizovan (sort), imena
-- automatski generisanih ogranicenja se ne porede, vec njihova definicija. Pokriva ono sto RLS i klijent stvarno koriste.
select 'COL ' || table_name || '.' || column_name || ' ' || data_type || ' null=' || is_nullable || ' def=' || coalesce(column_default, '')
  from information_schema.columns where table_schema = 'public'
union all select 'CON ' || conrelid::regclass || ' ' || contype::text || ' ' || pg_get_constraintdef(oid)
  from pg_constraint where connamespace = 'public'::regnamespace
union all select 'IDX ' || indexdef from pg_indexes where schemaname = 'public'
union all select 'POL ' || tablename || ' ' || policyname || ' ' || cmd || ' ' || roles::text || ' q=' || coalesce(qual, '') || ' wc=' || coalesce(with_check, '')
  from pg_policies where schemaname = 'public'
union all select 'TRG ' || regexp_replace(pg_get_triggerdef(t.oid), ' ON [^ ]+ ', ' ON x ')
  from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
union all select 'FUN ' || p.proname || '(' || pg_get_function_arguments(p.oid) || ') ' || pg_get_function_result(p.oid)
         || ' sec=' || p.prosecdef || ' vol=' || p.provolatile::text || ' cfg=' || coalesce(p.proconfig::text, '') || ' md5=' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
  from pg_proc p where p.pronamespace = 'public'::regnamespace
union all select 'FEX ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') anon=' || has_function_privilege('anon', p.oid, 'execute')
         || ' auth=' || has_function_privilege('authenticated', p.oid, 'execute')
  from pg_proc p where p.pronamespace = 'public'::regnamespace
union all select 'VIEW ' || viewname || ' ' || md5(regexp_replace(definition, '\s+', ' ', 'g')) from pg_views where schemaname = 'public'
union all select 'RLS ' || relname || ' ' || relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
union all select 'TGR ' || table_name || ' ' || grantee || ' ' || privilege_type
  from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
union all select 'CGR ' || table_name || '.' || column_name || ' ' || grantee || ' ' || privilege_type
  from information_schema.column_privileges where table_schema = 'public' and grantee in ('anon', 'authenticated') and table_name not in (select table_name from information_schema.role_table_grants g where g.table_schema = 'public' and g.grantee = column_privileges.grantee and g.privilege_type = column_privileges.privilege_type)
order by 1;
