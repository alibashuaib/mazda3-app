-- Parity check: public.shop_norm(name) must equal JS shops.norm()+slice(0,80).
-- Run after schema.sql:  psql -v ON_ERROR_STOP=1 -v fixture="$(cat test/fixtures/shop-norm.json)" -f supabase/tests/shop-norm.sql
-- Raises 'FAIL: ...' on any mismatch; finishing silently means pass.
-- Locale guard: a non-Unicode-aware database (e.g. C locale) must fail loudly here.
do $$ begin
  if public.shop_norm('مركز السلام') is distinct from 'مركز السلام' or public.shop_norm('ÉCOLE') is distinct from 'école' then
    raise exception 'FAIL: database locale is not Unicode-aware (need UTF-8, e.g. en_US.UTF-8)';
  end if;
end $$;
select set_config('shopnorm.fixture', :'fixture', false) \g /dev/null
do $$ declare r record; got text; begin
  for r in select e->>0 as input, e->>1 as expected from jsonb_array_elements(current_setting('shopnorm.fixture')::jsonb) e loop
    got := public.shop_norm(r.input);
    if r.input ~ '[\u0600-\u06ff]' and got = '' then raise exception 'FAIL: Arabic fixture % normalised to empty (locale?)', r.input; end if;
    if got is distinct from r.expected then
      raise exception 'FAIL: shop_norm(%) = %, JS says %', r.input, got, r.expected;
    end if;
  end loop;
end $$;
