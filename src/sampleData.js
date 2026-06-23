export const sampleArtists = [
  { ratingKey: 'a1', title: 'The Velvet Satellites', index: 1 },
  { ratingKey: 'a2', title: 'Cassette Garden', index: 2 },
  { ratingKey: 'a3', title: 'Laser Breakfast', index: 3 },
  { ratingKey: 'a4', title: 'Marigold Frequency', index: 4 },
];

export const sampleAlbums = [
  { ratingKey: 'al1', parentTitle: 'The Velvet Satellites', title: 'Night Market Radio', year: 2024, leafCount: 10 },
  { ratingKey: 'al2', parentTitle: 'Cassette Garden', title: 'Tiny Rooms, Big Drums', year: 2021, leafCount: 12 },
  { ratingKey: 'al3', parentTitle: 'Laser Breakfast', title: 'Chrome Pancakes', year: 2019, leafCount: 9 },
  { ratingKey: 'al4', parentTitle: 'Marigold Frequency', title: 'Pocket Sun Parade', year: 2022, leafCount: 11 },
];

export const sampleTracks = [
  { ratingKey: 't1', title: 'Velcro Comet', parentTitle: 'Night Market Radio', grandparentTitle: 'The Velvet Satellites', duration: 218000, index: 1 },
  { ratingKey: 't2', title: 'Arcade Raincheck', parentTitle: 'Night Market Radio', grandparentTitle: 'The Velvet Satellites', duration: 194000, index: 2 },
  { ratingKey: 't3', title: 'Plants With Headphones', parentTitle: 'Tiny Rooms, Big Drums', grandparentTitle: 'Cassette Garden', duration: 243000, index: 1 },
  { ratingKey: 't4', title: 'Borrowed Keyboard', parentTitle: 'Tiny Rooms, Big Drums', grandparentTitle: 'Cassette Garden', duration: 201000, index: 2 },
  { ratingKey: 't5', title: 'Syrup Modem', parentTitle: 'Chrome Pancakes', grandparentTitle: 'Laser Breakfast', duration: 232000, index: 1 },
  { ratingKey: 't6', title: 'Sunroof Tambourine', parentTitle: 'Pocket Sun Parade', grandparentTitle: 'Marigold Frequency', duration: 227000, index: 1 },
];
