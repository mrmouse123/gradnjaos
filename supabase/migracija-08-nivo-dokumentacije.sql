-- Migracija 08: nivo projektne dokumentacije za modul Projektovanje
alter table gradilista add column if not exists nivo text;
-- vrednosti: 'IDR' | 'IDP/PGD' | 'PZI'
