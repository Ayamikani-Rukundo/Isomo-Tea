update public.conversations
set title = 'Isomo Community'
where kind = 'general'
  and title in ('General Tea', 'Delta Tea');
