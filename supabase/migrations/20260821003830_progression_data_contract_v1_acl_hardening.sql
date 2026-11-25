revoke all on function public.progression_data_contract_v1(uuid, integer, date) from anon;
revoke all on function public.progression_data_contract_v1(uuid, integer, date) from public;
grant execute on function public.progression_data_contract_v1(uuid, integer, date) to authenticated, service_role;
