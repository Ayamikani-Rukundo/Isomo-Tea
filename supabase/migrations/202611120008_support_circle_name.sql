update public.conversations
set title = 'Support Circle'
where kind = 'general'
  and title in ('General Tea', 'Delta Tea', 'Isomo Community');
