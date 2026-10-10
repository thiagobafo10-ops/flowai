-- Valores novos de enum não podem ser usados na mesma transação: ficam em arquivo próprio.
alter type public.channel_type add value if not exists 'simulator';
alter type public.contact_source add value if not exists 'simulator';
