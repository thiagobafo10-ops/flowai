-- Suporte a 'anyKeyword' ou mode 'any' no casamento de palavras-chave / comentários de automação
create or replace function private.automation_keyword_matches(p_text text, p_config jsonb) returns boolean
language plpgsql stable set search_path = '' as $$
declare v_text text := private.automation_normalize(p_text); v_mode text := p_config ->> 'mode'; k text; v_kw text;
  n int; v_from int;
begin
  if coalesce((p_config ->> 'anyKeyword')::boolean, false) = true or v_mode = 'any' then
    return true;
  end if;
  if v_text = '' or jsonb_typeof(p_config -> 'keywords') is distinct from 'array' then return false; end if;
  for k in select jsonb_array_elements_text(p_config -> 'keywords') loop
    v_kw := private.automation_normalize(k);
    continue when v_kw = '';
    if (v_mode = 'equals' and v_text = v_kw)
       or (v_mode = 'starts_with' and left(v_text, char_length(v_kw)) = v_kw) then
      return true;
    end if;
    if v_mode = 'contains' then
      v_from := 1;
      loop
        n := strpos(substr(v_text, v_from), v_kw);
        exit when n = 0;
        n := n + v_from - 1;
        if (n = 1 or substr(v_text, n - 1, 1) !~ '[[:alnum:]_]')
           and (n + char_length(v_kw) > char_length(v_text) or substr(v_text, n + char_length(v_kw), 1) !~ '[[:alnum:]_]') then
          return true;
        end if;
        v_from := n + 1;
      end loop;
    end if;
  end loop;
  return false;
end $$;
