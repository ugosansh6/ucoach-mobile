create or replace function public.protect_profile_server_managed_fields()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and new.subscription_tier is distinct from old.subscription_tier then
    raise exception 'subscription_tier is server managed';
  end if;
  return new;
end;
$function$;

revoke execute on function public.protect_profile_server_managed_fields() from public,anon,authenticated;

drop trigger if exists trg_protect_profile_server_managed_fields on public.profiles;
create trigger trg_protect_profile_server_managed_fields
before update on public.profiles
for each row execute function public.protect_profile_server_managed_fields();;
