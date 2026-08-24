-- Flagship lenses: each demos a distinct engine capability (decision #13).
-- Canada+Ontario = depth & sub-national · Ukraine = crisis relevance · India = translingual.

INSERT INTO lenses (id, slug, name, country_fips, description)
SELECT 'lens-ca', 'canada', 'Canada', 'CA',
       'What the world''s press is saying about Canada — policy, politics, economy.'
WHERE NOT EXISTS (SELECT 1 FROM lenses WHERE slug='canada');

INSERT INTO lenses (id, slug, name, country_fips, description)
SELECT 'lens-on', 'ontario', 'Ontario', 'CA',
       'Sub-national lens: provincial affairs and the Greater Toronto story.'
WHERE NOT EXISTS (SELECT 1 FROM lenses WHERE slug='ontario');

INSERT INTO lenses (id, slug, name, country_fips, description)
SELECT 'lens-ua', 'ukraine', 'Ukraine', 'UP',
       'War, security and reconstruction — where pro watchers look first.'
WHERE NOT EXISTS (SELECT 1 FROM lenses WHERE slug='ukraine');

INSERT INTO lenses (id, slug, name, country_fips, description)
SELECT 'lens-in', 'india', 'India', 'IN',
       'One English query surfaces Hindi, Tamil and Bengali press too — GDELT machine-translates everything.'
WHERE NOT EXISTS (SELECT 1 FROM lenses WHERE slug='india');

-- Canada watches
INSERT INTO watches (id, lens_id, label, terms, geo_terms, timespan, sort, maxrecords)
SELECT 'w-ca-climate', l.id, 'Climate & carbon policy',
       json_array('carbon tax','climate policy','emissions reduction'),
       json_array('Canada','Ottawa'), '14d', 'DateDesc', 50
FROM lenses l WHERE l.slug='canada'
AND NOT EXISTS (SELECT 1 FROM watches WHERE id='w-ca-climate');

INSERT INTO watches (id, lens_id, label, terms, geo_terms, timespan, sort, maxrecords)
SELECT 'w-ca-housing', l.id, 'Housing',
       json_array('housing market','affordable housing','rent prices'),
       json_array('Canada'), '14d', 'DateDesc', 50
FROM lenses l WHERE l.slug='canada'
AND NOT EXISTS (SELECT 1 FROM watches WHERE id='w-ca-housing');

INSERT INTO watches (id, lens_id, label, terms, geo_terms, timespan, sort, maxrecords)
SELECT 'w-ca-politics', l.id, 'Federal politics',
       json_array('Trudeau','Poilievre','parliament hill'),
       json_array('Canada'), '7d', 'DateDesc', 50
FROM lenses l WHERE l.slug='canada'
AND NOT EXISTS (SELECT 1 FROM watches WHERE id='w-ca-politics');

-- Ontario
INSERT INTO watches (id, lens_id, label, terms, geo_terms, timespan, sort, maxrecords)
SELECT 'w-on-prov', l.id, 'Provincial affairs',
       json_array('Ontario legislature','Ford government','Queens Park'),
       json_array('Ontario','Toronto'), '14d', 'DateDesc', 50
FROM lenses l WHERE l.slug='ontario'
AND NOT EXISTS (SELECT 1 FROM watches WHERE id='w-on-prov');

-- Ukraine
INSERT INTO watches (id, lens_id, label, terms, geo_terms, timespan, sort, maxrecords)
SELECT 'w-ua-war', l.id, 'Security situation',
       json_array('drone strikes','counteroffensive','air defense'),
       json_array('Ukraine','Kyiv'), '7d', 'ToneDesc', 50
FROM lenses l WHERE l.slug='ukraine'
AND NOT EXISTS (SELECT 1 FROM watches WHERE id='w-ua-war');

INSERT INTO watches (id, lens_id, label, terms, geo_terms, timespan, sort, maxrecords)
SELECT 'w-ua-rebuild', l.id, 'Reconstruction & aid',
       json_array('reconstruction','aid package','EU membership'),
       json_array('Ukraine'), '1m', 'DateDesc', 50
FROM lenses l WHERE l.slug='ukraine'
AND NOT EXISTS (SELECT 1 FROM watches WHERE id='w-ua-rebuild');

-- India (translingual demo)
INSERT INTO watches (id, lens_id, label, terms, geo_terms, timespan, sort, maxrecords)
SELECT 'w-in-national', l.id, 'National affairs (all languages)',
       json_array('parliament','general election','supreme court'),
       json_array('India','Delhi'), '14d', 'DateDesc', 75
FROM lenses l WHERE l.slug='india'
AND NOT EXISTS (SELECT 1 FROM watches WHERE id='w-in-national');
