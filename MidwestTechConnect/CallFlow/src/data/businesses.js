// Mock dataset. Bundled with the app so the demo never depends on a network.
export const CATEGORIES = ['Plumber', 'Pizza', 'Dentist', 'Auto repair', 'Coffee shop'];

const CATEGORY_LABEL = {
  Plumber: 'Plumbing',
  Pizza: 'Pizza',
  Dentist: 'Dentistry',
  'Auto repair': 'Auto Repair',
  'Coffee shop': 'Coffee Shop',
};

// Aliases let free-text searches like "plumbing" or "coffee" still hit a category.
const ALIASES = {
  Plumber: ['plumber', 'plumbing', 'pipes', 'leak', 'drain'],
  Pizza: ['pizza', 'pizzeria', 'slice'],
  Dentist: ['dentist', 'dental', 'dentistry', 'teeth'],
  'Auto repair': ['auto', 'auto repair', 'mechanic', 'car', 'garage', 'tires'],
  'Coffee shop': ['coffee', 'coffee shop', 'cafe', 'espresso', 'latte'],
};

export const BUSINESSES = [
  { id: 'p1', category: 'Plumber', name: "Joe's Plumbing", phone: '(555) 867-5309', location: '123 Main Street' },
  { id: 'p2', category: 'Plumber', name: 'Lakeside Drain & Pipe', phone: '(555) 214-7788', location: '48 Harbor Road' },
  { id: 'p3', category: 'Plumber', name: 'Brew City Plumbing Co.', phone: '(555) 390-1122', location: '910 Water Street' },
  { id: 'p4', category: 'Plumber', name: 'Reliable Rooter', phone: '(555) 602-4471', location: '27 Oak Avenue' },
  { id: 'p5', category: 'Plumber', name: 'North Shore Pipeworks', phone: '(555) 775-9034', location: '1500 Lincoln Memorial Drive' },

  { id: 'z1', category: 'Pizza', name: 'Pizza Palace', phone: '(555) 331-0099', location: '400 Brady Street' },
  { id: 'z2', category: 'Pizza', name: "Tony's Tavern Pizza", phone: '(555) 118-6650', location: '2200 Kinnickinnic Avenue' },
  { id: 'z3', category: 'Pizza', name: 'Cream City Slice', phone: '(555) 452-3817', location: '88 Wisconsin Avenue' },
  { id: 'z4', category: 'Pizza', name: 'Third Ward Pie Co.', phone: '(555) 909-2140', location: '315 Broadway' },
  { id: 'z5', category: 'Pizza', name: 'Bay View Brick Oven', phone: '(555) 276-5503', location: '2648 South Kinnickinnic Avenue' },

  { id: 'd1', category: 'Dentist', name: 'Bright Smile Dental', phone: '(555) 640-2211', location: '75 Prospect Avenue' },
  { id: 'd2', category: 'Dentist', name: 'East Side Family Dentistry', phone: '(555) 823-7706', location: '1920 North Farwell Avenue' },
  { id: 'd3', category: 'Dentist', name: 'Riverwalk Dental Group', phone: '(555) 517-0384', location: '600 Water Street' },
  { id: 'd4', category: 'Dentist', name: 'Dr. Chen Orthodontics', phone: '(555) 388-9912', location: '5300 Bluemound Road' },
  { id: 'd5', category: 'Dentist', name: 'Downtown Dental Care', phone: '(555) 141-6275', location: '250 Plankinton Avenue' },

  { id: 'a1', category: 'Auto repair', name: "Bob's Auto", phone: '(555) 772-4410', location: '3100 South 27th Street' },
  { id: 'a2', category: 'Auto repair', name: 'Precision Motorworks', phone: '(555) 205-8831', location: '1440 West National Avenue' },
  { id: 'a3', category: 'Auto repair', name: 'Lakefront Tire & Brake', phone: '(555) 963-1207', location: '820 East Capitol Drive' },
  { id: 'a4', category: 'Auto repair', name: 'Westside Garage', phone: '(555) 334-5566', location: '6700 West Greenfield Avenue' },
  { id: 'a5', category: 'Auto repair', name: "Honest Al's Service Center", phone: '(555) 480-7193', location: '2001 South Howell Avenue' },

  { id: 'c1', category: 'Coffee shop', name: 'Daily Grind Coffee', phone: '(555) 592-0043', location: '1200 East Brady Street' },
  { id: 'c2', category: 'Coffee shop', name: 'Harbor Roasters', phone: '(555) 718-3360', location: '455 Erie Street' },
  { id: 'c3', category: 'Coffee shop', name: 'Fuel Cafe', phone: '(555) 264-9185', location: '818 East Center Street' },
  { id: 'c4', category: 'Coffee shop', name: 'Stone Creek Corner', phone: '(555) 801-2277', location: '422 North 5th Street' },
  { id: 'c5', category: 'Coffee shop', name: 'Anodyne Coffee House', phone: '(555) 137-4498', location: '224 West Bruce Street' },
];

export function categoryLabel(category) {
  return CATEGORY_LABEL[category] ?? category;
}

export function searchBusinesses(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const matchedCategories = CATEGORIES.filter((cat) =>
    ALIASES[cat].some((alias) => alias.includes(q) || q.includes(alias))
  );

  const byCategory = BUSINESSES.filter((b) => matchedCategories.includes(b.category));
  if (byCategory.length) return byCategory.slice(0, 5);

  // Fall back to a name search so typing "Joe" still finds Joe's Plumbing.
  return BUSINESSES.filter((b) => b.name.toLowerCase().includes(q)).slice(0, 5);
}
