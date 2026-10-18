begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
\ir helpers/phase11_fixtures.sql
\ir helpers/phase16c0_assertions.sql
select * from finish();
rollback;
