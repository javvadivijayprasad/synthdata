// fakelite: tiny, dependency-free, seed-driven fake data.
// Covers the faker methods commonly used in generation plans, works
// identically in Node and the browser (uses the engine's seeded rng).

const FIRST = ['Aarav','Vivaan','Aditya','Arjun','Reyansh','Ishaan','Kabir','Ananya','Diya','Ira',
  'Myra','Sara','Aadhya','Kiara','James','Mary','John','Priya','Rahul','Sneha','Vikram','Neha',
  'Amit','Pooja','Ravi','Anjali','Karan','Meera','Suresh','Lakshmi'];
const LAST = ['Sharma','Verma','Iyer','Patel','Reddy','Nair','Gupta','Mehta','Singh','Khan',
  'Das','Roy','Chopra','Malhotra','Joshi','Kulkarni','Rao','Menon','Smith','Johnson',
  'Bhat','Pillai','Saxena','Trivedi','Banerjee','Mukherjee','Chatterjee','Desai','Shah','Kapoor'];
const CITIES = ['Bengaluru','Mumbai','Delhi','Hyderabad','Chennai','Pune','Kolkata','Ahmedabad',
  'Jaipur','Kochi','Indore','Nagpur','Lucknow','Surat','Coimbatore','Visakhapatnam'];
const STATES = ['Karnataka','Maharashtra','Delhi','Telangana','Tamil Nadu','West Bengal',
  'Gujarat','Rajasthan','Kerala','Madhya Pradesh','Uttar Pradesh','Andhra Pradesh'];
const STREETS = ['MG Road','Brigade Road','Link Road','Station Road','Mall Road','Ring Road',
  'Church Street','Park Street','Hill Road','Lake View Road','Gandhi Nagar','Nehru Street'];
const WORDS = ['alpha','vertex','nova','pulse','matrix','orbit','prism','quartz','zenith','delta',
  'ember','flux','harbor','signal','summit','vector','willow','beacon','cascade','meridian'];
const COMPANY_A = ['Blue','Prime','Nex','Apex','Uni','Meta','Omni','True','Bright','Swift'];
const COMPANY_B = ['Tech','Soft','Works','Labs','Systems','Solutions','Retail','Traders','Mart','Industries'];
const DOMAINS = ['example.com','mail.example.org','test.example.net'];

export function fakerValue(method, rng) {
  const pick = (arr) => arr[Math.floor(rng.random() * arr.length)];
  switch (method) {
    case 'name': case 'fullName': return `${pick(FIRST)} ${pick(LAST)}`;
    case 'first_name': case 'firstName': return pick(FIRST);
    case 'last_name': case 'lastName': return pick(LAST);
    case 'email': return `${pick(FIRST).toLowerCase()}.${pick(LAST).toLowerCase()}${rng.randint(1, 9999)}@${pick(DOMAINS)}`;
    case 'phone_number': case 'phone': return `+91-9${rng.randint(100000000, 999999999)}`;
    case 'city': return pick(CITIES);
    case 'state': return pick(STATES);
    case 'street_address': case 'streetAddress':
      return `${rng.randint(1, 999)}, ${pick(STREETS)}`;
    case 'postcode': case 'zipcode': return String(rng.randint(110001, 999999));
    case 'company': return `${pick(COMPANY_A)}${pick(COMPANY_B)}`;
    case 'catch_phrase': case 'catchPhrase':
      return `${pick(WORDS)[0].toUpperCase() + pick(WORDS).slice(1)} ${pick(WORDS)} ${pick(WORDS)}`;
    case 'word': return pick(WORDS);
    case 'sentence': {
      const n = rng.randint(6, 12);
      const ws = Array.from({ length: n }, () => pick(WORDS));
      return ws[0][0].toUpperCase() + ws.join(' ').slice(1) + '.';
    }
    case 'text': case 'paragraph': {
      const parts = Array.from({ length: 3 }, () => fakerValue('sentence', rng));
      return parts.join(' ');
    }
    case 'user_name': case 'userName':
      return `${pick(FIRST).toLowerCase()}${rng.randint(1, 999)}`;
    case 'uuid': {
      const h = () => rng.randint(0, 15).toString(16);
      return `${'x'.repeat(8)}-xxxx-4xxx-yxxx-${'x'.repeat(12)}`.replace(/[xy]/g,
        c => c === 'x' ? h() : ((rng.randint(0, 15) & 0x3) | 0x8).toString(16));
    }
    default: return fakerValue('word', rng);
  }
}
