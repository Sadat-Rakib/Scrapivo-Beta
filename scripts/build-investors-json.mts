/**
 * Compact investor seed rows:
 * [name, firm, title, sweet, minMax, locationsCsv, focusesCsv, batch]
 * focusesCsv uses "Sector (Stage)|Sector (Stage)"
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveStatus,
  inferType,
  parseFocus,
  parseMoney,
  parseRange,
  slugifyInvestor,
  type InvestorRecord,
  type InvestorsFile,
} from "../src/lib/investors/types";
import { MORE_PRESEED } from "./investor-batches/more-preseed.mts";
import { ASIA_PRESEED } from "./investor-batches/asia-preseed.mts";
import { CANADA } from "./investor-batches/canada.mts";

type Row = [string, string, string, string, string, string, string, string?];

const BATCH_LABELS: Record<string, string> = {
  preseed: "user_seed_preseed_2026",
  asia_preseed: "user_seed_asia_preseed_2026",
  canada: "user_seed_canada_2026",
};

const CORE_ROWS: Row[] = [
  ["Roger Kitterman", "Mass General Brigham Ventures", "Managing Partner", "$1.5M", "$100K – $5M", "Massachusetts", "BioTech (Seed)|BioTech (Series A)"],
  ["Alfredo Hahn", "Upload Ventures", "Investor", "$5.5M", "$1M – $10M", "Sao Paulo, Brazil", "Web3/Blockchain (Series B)|Web3/Crypto (Series B)|Education (Series B)"],
  ["Cailen DSa", "Wellfound", "Advisor", "$13M", "$500K – $20M", "Carlsbad, California", "FinTech (Series B)|SaaS (Series B)|FinTech (Seed)"],
  ["Zhenya Loginov", "Accel", "Partner", "$5M", "$500K – $25M", "Israel|Europe", "Cloud Infrastructure (Series A)|SaaS (Series A)|Developer Tools (Seed)"],
  ["Zachariah Reitano", "Independent", "Angel", "$25K", "$5K – $50K", "New York, New York", "Consumer Health (Series B)|Health & Hospital Services (Series B)|Health IT (Series B)"],
  ["J.P. Keating", "VU Venture Partners", "Venture Partner", "$100K", "$25K – $500K", "Global|United States", "TransportationTech (Seed)|IoT (Seed)|ClimateTech/CleanTech (Seed)"],
  ["Tom McNerney", "True Global Ventures", "Partner", "$1.5M", "$100K – $5M", "London|Singapore", "Web3/Blockchain (Seed)|Web3/Blockchain (Series A)|SaaS (Seed)"],
  ["Nigel Hawley", "True Global Ventures", "Investor", "$1.5M", "$100K – $5M", "London|Singapore", "Web3/Blockchain (Seed)|Web3/Blockchain (Series A)|SaaS (Seed)"],
  ["Renato Huljev", "True Global Ventures", "Partner", "$1.5M", "$100K – $5M", "London|Singapore", "Web3/Blockchain (Seed)|Web3/Blockchain (Series A)|SaaS (Seed)"],
  ["David Mounts", "Aero X Ventures", "Partner", "$1.8M", "$500K – $3M", "Las Vegas, Nevada", "Food and Beverage (Seed)|Food and Beverage (Series A)|Logistics (Seed)"],
  ["Neha Singh", "Independent", "Unknown", "$0", "$0 – $0", "Palo Alto, California", "Social Networks (Seed)|ClimateTech/CleanTech (Seed)|FinTech (Seed)"],
  ["Larry O’Mahony", "Elkstone", "Analyst", "$2M", "$1M – $3M", "Dublin, Ireland", "FinTech (Series A)|FinTech (Seed)"],
  ["Eric Larchevêque", "Independent", "Angel", "$25K", "$5K – $50K", "France", "SMB Software (Seed)|Robotics (Seed)|Web3/Blockchain (Seed)"],
  ["Bob Young", "Independent", "Angel", "$25K", "$5K – $50K", "Raleigh, North Carolina", "Games (Seed)|Gaming/eSports (Seed)|Entertainment & Sports (Seed)"],
  ["Carl Murray", "Elkstone", "Associate", "$2M", "$1M – $3M", "Dublin, Ireland", "Real Estate/PropTech (Seed)|Real Estate/PropTech (Series A)|FinTech (Series A)"],
  ["J Seth Strattan PhD", "Two Bear Capital", "Partner", "$10M", "$1M – $20M", "", "Material Science (Seed)|Medical Devices (Seed)|AI (Series B)"],
  ["Deepika Jonnalagadda", "Blu Venture Investors", "Analyst", "$750K", "$500K – $1M", "Washington, District of Columbia", "Material Science (Seed)|SMB Software (Seed)|Security (Seed)"],
  ["Rayyan Islam", "8090 Industries", "General Partner", "$1.5M", "$100K – $5M", "Dallas, Texas", "SMB Software (Seed)|AI (Series B)|Impact (Seed)"],
  ["Marco Janeczek", "Independent", "Unknown", "$0", "$0 – $0", "Ottawa", "Fashion (Seed)|Sales & CRM (Seed)|Hardware (Seed)"],
  ["Steve Abbott", "Sapphire Ventures", "Partner", "$25M", "$10M – $100M", "Austin, Texas|San Francisco, California", "Cloud Infrastructure (Series B)|Entertainment & Sports (Series B)|Entertainment & Sports (Series A)"],
  ["Matt Tagg", "Independent", "Unknown", "$0", "$0 – $0", "Palo Alto, California", "Parenting/Families (Seed)|Local Services (Seed)|Retail (Seed)"],
  ["Daniel Chesley", "Work-Bench", "Associate", "$1.5M", "$100K – $5M", "New York, New York", "AI (Seed)|AI (Series A)|Enterprise (Series A)"],
  ["Alain Balthazart", "Noshaq", "Investor", "$1.5M", "$100K – $5M", "Belgium", "AgTech (Series B)|Consumer Health (Series B)|AgTech (Series A)"],
  ["Julie Gaspard", "Noshaq", "Investor", "$1.5M", "$100K – $5M", "Belgium", "TransportationTech (Series B)|TransportationTech (Series A)|E-commerce (Series B)"],
  ["Gaetan Gottschalk", "Noshaq", "Investor", "$1.5M", "$100K – $5M", "Belgium", "Retail (Seed)|BioTech (Series B)|Real Estate/PropTech (Seed)"],
  ["Mario Ermirio de Moraes Filho", "Upload Ventures", "Managing Partner", "$5.5M", "$1M – $10M", "Sao Paulo, Brazil", "Human Capital/HRTech (Seed)|Web3/Blockchain (Series B)|Web3/Crypto (Series B)"],
  ["Jeffrey Yingling", "Energy Capital Ventures", "Partner", "$1.5M", "$100K – $5M", "Chicago, Illinois", "EnergyTech (Seed)|ClimateTech/CleanTech (Seed)|BioTech (Seed)"],
  ["Sebastian L. Johansson", "byFounders", "Investor", "$1M", "$200K – $2M", "Berlin, Germany|Copenhagen, Denmark", "Consumer Internet (Seed)|Enterprise (Seed)|Enterprise (Series A)"],
  ["Joost van der Plas", "Maven 11 Capital", "Managing Partner", "$1.5M", "$100K – $5M", "Amsterdam, Netherlands", "Web3/Blockchain (Seed)|Web3/Blockchain (Series A)|Web3/Crypto (Series A)"],
  ["Maroof Ahmed", "Independent", "Angel", "$25K", "$5K – $50K", "United Kingdom", "Human Capital/HRTech (Seed)|Medical Devices (Seed)|Consumer Health (Seed)"],
  ["Balder Bomans", "Maven 11 Capital", "Managing Partner", "$1.5M", "$100K – $5M", "Amsterdam, Netherlands", "Web3/Blockchain (Seed)|Web3/Crypto (Seed)|FinTech (Seed)"],
  ["Scott Wilson", "Wunala Capital", "Managing Partner", "$3M", "$500K – $5M", "Melbourne, Australia|Brisbane, Australia", "AI (Series B)|Data Services (Series B)|Payments (Series B)"],
  ["Trevor Neff", "Sound Ventures", "Investor", "$1M", "$100K – $10M", "Los Angeles, California", "Consumer Internet (Seed)|Enterprise (Seed)|Enterprise (Series A)"],
  ["Brice Delome", "Quadrille Capital", "Partner", "$1.5M", "$100K – $5M", "Paris, France", "Consumer Health (Series B)|Consumer Health (Series A)|Consumer Internet (Series B)"],
  ["Henry Moulton", "Passion Capital", "Investor", "$1.5M", "$100K – $5M", "London", "Data Services (Series B)|IoT (Series B)|Data Services (Series A)"],
  ["David Litwack", "Alliance of Angels", "Unknown", "$1M", "$500K – $1.5M", "Seattle, Washington", "Retail (Seed)|Hardware (Seed)|Hardware (Series A)"],
  ["Dan Conner", "Ascend Venture Capital", "Managing Director", "$150K", "$50K – $1M", "St. Louis, Missouri", "EnergyTech (Seed)|Data Services (Seed)|Web3/Blockchain (Seed)"],
  ["Julie Liao", "Yes VC", "Principal", "$500K", "$250K – $1M", "Europe|United States", "Real Estate/PropTech (Seed)|EnergyTech (Seed)|ClimateTech/CleanTech (Seed)"],
  ["Bersabel Tadesse", "Bowery Capital", "Venture Partner", "$1.5M", "$100K – $5M", "San Francisco, California", "TransportationTech (Seed)|Logistics (Seed)|TransportationTech (Pre-seed)"],
  ["Shashank Saxena", "Bowery Capital", "Venture Partner", "$1.5M", "$100K – $5M", "Cincinnati, Ohio|Tampa, Florida", "TransportationTech (Seed)|Logistics (Seed)|SaaS (Seed)"],
  ["Sean Hundtofte", "Independent", "Angel", "$25K", "$5K – $50K", "Brooklyn, New York", "Consumer Internet (Seed)|FinTech (Seed)|Consumer Internet (Pre-seed)"],
  ["Young Guo", "IDG Capital", "General Partner", "$50M", "$1M – $100M", "China|San Francisco Bay Area", "AI (Series B)|Enterprise (Series B)|AI (Seed)"],
  ["Eric Demuth", "Independent", "Angel", "$25K", "$5K – $50K", "Vienna, Austria", "Web3/Crypto (Seed)|FinTech (Seed)"],
  ["John Paul Milciunas", "Baselayer VC", "Managing Director", "$1M", "$100K – $1M", "Miami, Florida", "AR/VR (Series A)|AR/VR (Seed)|Analytics (Series A)"],
  ["Steven Ji", "Sequoia Capital", "Partner", "$25M", "$10M – $50M", "China", "TransportationTech (Series A)|TransportationTech (Seed)|AI (Seed)"],
  ["Neil Shen", "Sequoia Capital China", "Managing Partner", "$25M", "$10M – $50M", "China|Hong Kong", "Consumer Internet (Series B)|Enterprise (Series B)|Enterprise (Series A)"],
  ["Albert Armengol", "Independent", "Angel", "$25K", "$5K – $50K", "Barcelona, Spain", "Insurance (Seed)|Insurance (Series B)|Consumer Internet (Series B)"],
  ["Enrique Allen", "Designer Fund", "Managing Partner", "$500K", "$100K – $1M", "San Francisco, California", "Travel (Seed)|Media/Content (Seed)|ClimateTech/CleanTech (Seed)"],
  ["Ian Marsh", "DN Capital", "Partner", "$11M", "$1M – $22M", "London", "SMB Software (Seed)|E-commerce (Series B)|E-commerce (Series A)"],
  ["Elton Pereira", "SureSwift Capital", "Partner", "$1.5M", "$100K – $1.5M", "British Columbia", "MarketingTech (Seed)|Web3/Blockchain (Seed)|Consumer Health (Seed)"],
  ["Teddy Albertson", "Kairos Ventures", "Associate", "$10M", "$150K – $20M", "Pasadena, California", "Pharmaceuticals (Seed)|EnergyTech (Series A)|EnergyTech (Seed)"],
  ["Mark Yingling", "Energy Capital Ventures", "Associate", "$1.5M", "$100K – $5M", "Chicago, Illinois", "EnergyTech (Seed)|ClimateTech/CleanTech (Seed)|BioTech (Seed)"],
  ["Stefano Galiasso", "Energy Capital Ventures", "Senior Associate", "$1.5M", "$100K – $5M", "Chicago, Illinois", "EnergyTech (Seed)|ClimateTech/CleanTech (Seed)|BioTech (Seed)"],
  ["Emily Gaudiano", "MPM Capital", "Associate", "$25M", "$1M – $150M", "United States", "Pharmaceuticals (Seed)|BioTech (Series B)|Pharmaceuticals (Series B)"],
  ["Sir Martin Sorrell", "S4S Ventures", "Investor", "$1.5M", "$100K – $5M", "London", "Advertising (Seed)|MarketingTech (Seed)|Media/Content (Seed)"],
  ["Andy Johns", "Unusual Ventures", "Partner", "$250K", "$100K – $500K", "United States|Redwood City, California", "Games (Seed)|Games (Series A)|Marketplaces (Series A)"],
  ["Caterina Fake", "Yes VC", "General Partner", "$250K", "$30K – $1.5M", "San Francisco Bay Area", "Consumer Internet (Seed)|Enterprise (Seed)|Consumer Internet (Pre-seed)"],
  ["Heath Lukatch", "Red Tree Venture Capital", "Managing Partner", "$1.5M", "$100K – $5M", "San Francisco, California", "Pharmaceuticals (Seed)|BioTech (Seed)|Consumer Health (Seed)"],
  ["Krishna Polu", "Red Tree Venture Capital", "Principal", "$1.5M", "$100K – $5M", "San Francisco Bay Area", "Pharmaceuticals (Seed)|ClimateTech/CleanTech (Seed)|BioTech (Seed)"],
  ["Jon Edwards", "Red Tree Venture Capital", "Managing Director", "$1.5M", "$100K – $5M", "San Francisco Bay Area", "Pharmaceuticals (Seed)|EnergyTech (Seed)|ClimateTech/CleanTech (Seed)"],
  ["Kate Burns", "Hambro Perks", "Venture Partner", "$7.5M", "$5M – $10M", "London", "AR/VR (Series B)|AR/VR (Series A)|AR/VR (Seed)"],
  ["Will Orr", "Hambro Perks", "Venture Partner", "$7.5M", "$5M – $10M", "London", "MarketingTech (Seed)|Media/Content (Seed)|MarketingTech (Series B)"],
  ["Assieh Marion Khamsi", "Antler", "Vice President", "$1.5M", "$100K – $5M", "London", "AI (Seed)|E-commerce (Seed)|Health IT (Seed)"],
  ["Jaynti Kanani", "Polygon", "Investor", "$200K", "$10K – $500K", "Global|India", "Web3/Blockchain (Seed)|Web3/Crypto (Seed)|Web3/Crypto (Pre-seed)"],
  ["Patrick Chase", "Redpoint Ventures", "Managing Director", "$25M", "$100K – $50M", "San Francisco Bay Area", "AI (Seed)|AI (Series A)|SaaS (Seed)"],
  ["Annie Collins", "Andreessen Horowitz", "Partner", "$20M", "$500K – $40M", "San Francisco, California", "BioTech (Seed)|BioTech (Series A)|Health IT (Series A)"],
  ["Zak Doric", "Andreessen Horowitz", "Partner", "$20M", "$500K – $40M", "San Francisco Bay Area", "BioTech (Seed)|BioTech (Series A)"],
  ["Gustaf Alströmer", "Y Combinator", "Partner", "$150K", "$150K – $150K", "South San Francisco, California|San Francisco Bay Area", "GovTech (Seed)|ClimateTech/CleanTech (Series A)|Education (Series A)"],
  ["Aaron Epstein", "Y Combinator", "Partner", "$150K", "$150K – $150K", "San Francisco Bay Area", "GovTech (Seed)|Education (Series A)|GovTech (Series A)"],
  ["Jon Levy", "Y Combinator", "Managing Director", "$150K", "$150K – $150K", "San Francisco Bay Area", "GovTech (Seed)|Retail (Seed)|Education (Series A)"],
  ["Ali Rowghani", "Y Combinator", "Unknown", "$150K", "$150K – $150K", "San Francisco Bay Area", "GovTech (Seed)|AI (Series B)|BioTech (Series B)"],
  ["Francisco Gimenez", "8VC", "Partner", "$16.5M", "$3M – $30M", "San Francisco Bay Area", "BioTech (Seed)|AI (Seed)|BioTech (Series A)"],
  ["Jack Moshkovich", "8VC", "Principal", "$16.5M", "$3M – $30M", "San Francisco Bay Area", "Consumer Internet (Series B)|Enterprise (Series B)|Consumer Internet (Seed)"],
  ["Brittany Walker", "CRV", "Principal", "$13M", "$500K – $20M", "Los Angeles, California", "SMB Software (Seed)|Developer Tools (Series B)|Developer Tools (Series A)"],
  ["Stephen Trusheim", "SignalFire", "Partner", "$12.5M", "$5M – $20M", "San Francisco Bay Area", "Robotics (Seed)|Robotics (Series A)|AI (Seed)"],
  ["James Burgum", "Arthur Ventures", "Partner", "$1.5M", "$100K – $5M", "Fargo, North Dakota", "SMB Software (Seed)|SMB Software (Series B)|SMB Software (Series A)", "preseed"],
  ["Manan Mehta", "Unshackled Ventures", "Managing Partner", "$500K", "$150K – $750K", "California|San Francisco, California", "AR/VR (Pre-seed)|AI (Pre-seed)|ClimateTech/CleanTech (Pre-seed)", "preseed"],
  ["Jonathan Shipman", "Independent", "Angel", "$1.5M", "$100K – $5M", "San Francisco Bay Area", "Gaming/eSports (Seed)|Gaming/eSports (Pre-seed)", "preseed"],
  ["Chip Davis", "Independent", "Managing Partner", "$500K", "$150K – $2M", "Austin, Texas|Houston, Texas", "Payments (Pre-seed)|Gig Economy (Pre-seed)|Enterprise Infrastructure (Pre-seed)", "preseed"],
  ["Sebastian Buenaventura", "Flori Ventures", "Senior Associate", "$300K", "$100K – $500K", "Africa|LatAm (Latin America)", "Local Services (Seed)|Impact (Seed)|Insurance (Seed)", "preseed"],
  ["Michiel Kotting", "Northzone", "Partner", "$15M", "$1M – $30M", "United Kingdom|London", "SaaS (Seed)|AI (Seed)|AI (Pre-seed)", "preseed"],
  ["Kim-Mai Cutler", "Initialized Capital", "Partner", "$2.5M", "$1M – $4M", "San Francisco Bay Area|San Francisco, California", "Web3/Blockchain (Seed)|Web3/Blockchain (Series A)|Web3/Crypto (Series A)", "preseed"],
  ["Inshaal Qadir", "Panache Ventures", "Investor", "$1.5M", "$1M – $5M", "Canada", "AI (Pre-seed)|AI (Seed)|Cybersecurity (Pre-seed)", "preseed"],
  ["Thomas Panton", "Endgame Capital", "Investor", "$500K", "$250K – $1M", "United States|Canada", "ClimateTech/CleanTech (Pre-seed)|ClimateTech/CleanTech (Seed)|EnergyTech (Pre-seed)", "preseed"],
  ["Alejandro Pereda", "Forum Ventures", "Associate", "$100K", "$50K – $250K", "United States|Canada", "AI (Pre-seed)", "preseed"],
  ["Soona Amhaz", "Volt Capital", "General Partner", "$500K", "$100K – $1M", "San Francisco Bay Area", "Web3/Blockchain (Seed)|Web3/Crypto (Seed)|Web3/Crypto (Pre-seed)", "preseed"],
  ["Nisa Amoils", "Grasshopper Capital", "Managing Partner", "$250K", "$50K – $2M", "Global", "Games (Seed)|Web3/Blockchain (Series B)|Impact (Seed)", "preseed"],
  ["Abe Murray", "AlleyCorp", "General Partner", "$1.5M", "$500K – $3M", "Europe|Israel", "Robotics (Seed)|Robotics (Series A)|AI (Seed)", "preseed"],
  ["Pegah Ebrahimi", "FPV Fund", "Managing Partner", "$1.5M", "$100K – $5M", "San Francisco Bay Area", "Consumer Internet (Seed)|Health & Hospital Services (Seed)|Enterprise Applications (Seed)", "preseed"],
  ["Somar Somasegar", "Madrona Ventures", "Managing Director", "$5M", "$500K – $10M", "Seattle, Washington", "AR/VR (Seed)|Cloud Infrastructure (Seed)|AI (Seed)", "preseed"],
  ["Chris Wake", "Atypical Ventures", "Managing Partner", "$750K", "$500K – $1M", "Global|New York, New York", "Hardware (Pre-seed)|Media/Content (Pre-seed)|Health IT (Pre-seed)", "preseed"],
  ["Balaji Srinivasan", "Independent", "Angel", "$100K", "$10K – $500K", "San Francisco Bay Area|San Francisco, California", "AI (Series B)|Web3/Crypto (Series B)|AI (Seed)", "preseed"],
  ["Matias Barbero", "FJ Labs", "Partner", "$400K", "$100K – $2M", "New York, New York", "AI (Series B)|Consumer Internet (Series B)|Marketplaces (Series B)", "preseed"],
  ["Prayank Swaroop", "Accel", "Partner", "$1M", "$300K – $10M", "Bangalore", "Sales & CRM (Seed)|Developer Tools (Series A)|Security (Seed)", "preseed"],
  ["Neil Capel", "Bowery Capital", "Venture Partner", "$1.5M", "$100K – $5M", "New York, New York", "TransportationTech (Seed)|Logistics (Seed)|TransportationTech (Pre-seed)", "preseed"],
  ["Rahul Mehta", "DST Global", "Managing Partner", "$25M", "$15M – $200M", "Dubai, United Arab Emirates|United States", "Web3/Blockchain (Series B)|Food and Beverage (Series B)|Consumer Internet (Series B)"],
  ["John Lindfors", "DST Global", "Managing Partner", "$25M", "$15M – $200M", "Hong Kong|China", "Consumer Internet (Series B)|Enterprise (Series B)|FinTech (Series B)"],
  ["Saurabh Gupta", "DST Global", "Managing Partner", "$25M", "$15M – $200M", "San Francisco Bay Area|China", "Consumer Internet (Series B)|Lodging/Hospitality (Series B)|Payments (Series B)"],
  ["Nicolas Berman", "Kaszek Ventures", "Partner", "$10M", "$500K – $25M", "Buenos Aires, Argentina|LatAm (Latin America)", "Consumer Internet (Series B)|Enterprise (Series B)|Enterprise (Series A)"],
  ["Jim O'Shaughnessy", "O'Shaughnessy Ventures", "Investor", "$1M", "$100K – $10M", "United States|Connecticut", "AI (Seed)|AI (Series A)|Generative Tech/AI (Seed)"],
  ["Andrew McKinzie", "aCrew Capital", "Investor", "$10M", "$2M – $20M", "New York, New York|San Francisco, California", "Web3/Blockchain (Seed)|Web3/Blockchain (Series B)|AI (Series A)"],
  ["Aditi Maliwal", "Upfront Ventures", "General Partner", "$1M", "$1M – $7M", "San Francisco, California", "Human Capital/HRTech (Seed)|Analytics (Series A)|Payments (Seed)"],
  ["Robert Nelsen", "ARCH Venture Partners", "Managing Director", "$75M", "$50K – $150M", "San Francisco Bay Area|Chicago, Illinois", "BioTech (Seed)|BioTech (Series A)|AI (Seed)"],
  ["Carl Gordon", "OrbiMed Advisors", "Managing Partner", "$4M", "$1M – $75M", "New York, New York", "Medical Devices (Seed)|Pharmaceuticals (Seed)|Medical Devices (Series B)"],
  ["Jason Foster", "Hambro Perks", "Venture Partner", "$7.5M", "$5M – $10M", "London", "Medical Devices (Seed)|Consumer Health (Series B)|Pharmaceuticals (Seed)"],
  ["Florian Seroussi", "355 Capital", "General Partner", "$250K", "$100K – $800K", "New York, New York", "AI (Series A)|Space (Series B)|Enterprise Applications (Pre-seed)"],
  ["Nomi Khedawala", "Independent", "Angel", "$25K", "$10K – $50K", "Global", "Social Networks (Pre-seed)|Lodging/Hospitality (Seed)|Messaging (Seed)"],
  ["Marc Butler", "Independent", "Angel", "$25K", "$5K – $50K", "Philadelphia, Pennsylvania", "Insurance (Seed)|Data Services (Seed)|FinTech (Seed)"],
  ["Adam Gross", "Independent", "Angel", "$25K", "$5K – $50K", "San Francisco, California", "SMB Software (Seed)|Developer Tools (Seed)|Analytics (Seed)"],
  ["Ron Suber", "Independent", "Angel", "$25K", "$5K – $50K", "Denver, Colorado", "Marketplaces (Series B)|FinTech (Series B)|Marketplaces (Series A)"],
  ["Robyn Rihanna Fenty", "Independent", "Angel", "$25K", "$5K – $50K", "New York, New York", "Fashion (Seed)|Fashion (Series A)|Cosmetics (Series A)"],
  ["Kevin Hart", "Independent", "Angel", "$25K", "$5K – $50K", "Los Angeles, California", "Fashion (Seed)|Entertainment & Sports (Series B)|Fashion (Series B)"],
  ["Zoë Barry", "Independent", "Angel", "$25K", "$5K – $50K", "Boston, Massachusetts", "Consumer Health (Seed)|Health IT (Seed)|Marketplaces (Seed)"],
  ["Zvi Guterman", "Independent", "Angel", "$25K", "$5K – $50K", "San Francisco, California", "Consumer Internet (Seed)|Enterprise (Series A)|Enterprise (Seed)"],
  ["Aatif Awan", "Indus Valley Capital", "Managing Partner", "$1.5M", "$100K – $5M", "San Francisco, California|San Francisco Bay Area", "Retail (Seed)|SMB Software (Seed)|Education (Series A)"],
  ["Bernard Liautaud", "Balderton Capital", "General Partner", "$10.5M", "$1M – $20M", "Europe|London", "SMB Software (Seed)|SMB Software (Series B)|SMB Software (Series A)", "preseed"],
  ["Andy Sack", "Founders Co-op", "Managing Partner", "$1.5M", "$100K – $5M", "Seattle, Washington", "Web3/Blockchain (Seed)|Web3/Blockchain (Series A)|Web3/Crypto (Series A)", "preseed"],
  ["Taryn Livingstone", "Soma Capital", "Investor", "$2.5M", "$1M – $5M", "San Francisco, California", "Hardware (Pre-seed)|Health IT (Pre-seed)|Digital Health (Pre-seed)", "preseed"],
  ["Chris Hofmann", "Bain Capital Crypto", "Partner", "$1.5M", "$100K – $5M", "Providence, Rhode Island", "Web3/Blockchain (Series A)|Web3/Crypto (Series A)|FinTech (Series A)", "preseed"],
  ["Owen Chun", "ENIAC Ventures", "Investor", "$700K", "$200K – $1.2M", "New York City", "Web3/Blockchain (Seed)|AI (Seed)|Web3/Crypto (Seed)", "preseed"],
  ["Sarah Du", "Uncork Capital", "Investor", "$2M", "$1M – $4M", "Princeton, New Jersey|New Jersey", "Consumer Health (Series B)|Developer Tools (Series B)|Developer Tools (Series A)", "preseed"],
  ["Gil Zimmermann", "2048 Ventures", "Investor", "$1.3M", "$500K – $2M", "Boston, Massachusetts", "Security (Seed)|Developer Tools (Seed)|Data Services (Seed)", "preseed"],
  ["Zack Ouderkirk", "Root Ventures", "Investor", "$1M", "$500K – $2M", "California", "Developer Tools (Series A)|Developer Tools (Seed)|Developer Tools (Pre-seed)"],
  ["Alex Shoer", "Elevation Ventures", "Partner", "$1.5M", "$100K – $5M", "Asheville, North Carolina", "EnergyTech (Seed)|ClimateTech/CleanTech (Seed)|EnergyTech (Pre-seed)"],
  ["Elizabeth (L.) Smith", "Offline Ventures", "Venture Partner", "$1.5M", "$1M – $2M", "Florida", "Web3/Crypto (Seed)|Web3/Crypto (Pre-seed)|FinTech (Pre-seed)"],
  ["Katie Stanton", "Moxxie Ventures", "General Partner", "$1.5M", "$1M – $1.5M", "United States|Boulder, Colorado", "Media/Content (Seed)|Health IT (Seed)|FinTech (Seed)"],
  ["Matt Kozlov", "Techstars", "Advisor", "$120K", "$120K – $120K", "", "AR/VR (Series A)|AR/VR (Seed)|Hardware (Seed)"],
  ["Sérgio Massano", "Antler", "Venture Partner", "$1.5M", "$100K – $5M", "Lisbon, Portugal", "AI (Seed)|E-commerce (Seed)|Health IT (Pre-seed)"],
  ["Brian Hollins", "Lightspeed Venture Partners", "Scout", "$1.5M", "$500K – $2.5M", "LatAm (Latin America)|United States", "SMB Software (Seed)|SMB Software (Series A)|Enterprise (Series A)"],
  ["Pete Solvik", "Jackson Square Ventures", "Managing Director", "$1.5M", "$100K – $5M", "San Francisco Bay Area", "Analytics (Seed)|TransportationTech (Seed)|E-commerce (Seed)"],
  ["JJ Richa", "Trenchant Ventures, LLC", "Managing Partner", "$500K", "$50K – $1M", "Canada|United States", "SaaS (Seed)|FinTech (Seed)|E-commerce (Series A)"],
  ["Christopher Calicott", "Trammell Venture Partners", "Managing Director", "$1.5M", "$100K – $5M", "Austin, Texas", "Web3/Blockchain (Seed)|AI (Seed)|Web3/Crypto (Seed)"],
  ["Warren Lorenz", "Blockchain Founders Fund", "Venture Partner", "$1.5M", "$100K – $5M", "New York, New York", "Web3/Blockchain (Seed)|Web3/Crypto (Seed)|FinTech (Seed)"],
  ["Mamelle Florent", "True Global Ventures", "Partner", "$1.5M", "$100K – $5M", "Malaysia", "Enterprise Applications (Seed)|Enterprise Applications (Pre-seed)|Enterprise (Pre-seed)"],
  ["Lili Rogowsky", "Atypical Ventures", "Investor", "$750K", "$500K – $1M", "", "Material Science (Seed)|Robotics (Seed)|Developer Tools (Seed)"],
  ["Joe Markson", "Novo Ventures", "Associate", "$1.5M", "$100K – $5M", "San Francisco, California", "Pharmaceuticals (Seed)|BioTech (Series B)|IoT (Series B)"],
  ["Suzanne Fletcher", "Zelda Ventures", "General Partner", "$1.5M", "$100K – $5M", "San Francisco, California", "Medical Devices (Seed)|Hardware (Seed)|Pharmaceuticals (Seed)"],
  ["Kabeer Aziz", "Adjuvant Capital", "Partner", "$1.5M", "$100K – $5M", "New York, New York", "Medical Devices (Seed)|Pharmaceuticals (Seed)|Consumer Health (Series A)"],
  ["Glenn Rockman", "Adjuvant Capital", "Managing Partner", "$1.5M", "$100K – $5M", "New York, New York", "Medical Devices (Seed)|Impact (Seed)|Pharmaceuticals (Seed)"],
  ["Andre Heinz", "Obvious Ventures", "Venture Partner", "$2M", "$1M – $3M", "San Francisco, California", "TransportationTech (Series B)|Impact (Seed)|TransportationTech (Series A)"],
  ["Youssef Kalad", "AlleyCorp", "Investor", "$1.5M", "$500K – $4M", "United States", "TransportationTech (Series A)|GovTech (Series A)|Education (Series A)"],
  ["Achal Upadhyaya", "Interlagos Capital", "Managing Partner", "$10M", "$4M – $40M", "United States", "Hardware (Seed)|Hardware (Pre-seed)|Hardware (Series B)"],
  ["Celine Haliqua", "The Longevity Fund", "Venture Partner", "$500K", "$100K – $1M", "San Francisco Bay Area|San Francisco, California", "BioTech (Seed)|Health IT (Series A)|BioTech (Series A)"],
  ["Levin Bunz", "Heartcore Capital", "Partner", "$5M", "$50K – $5M", "Berlin, Germany", "TransportationTech (Series A)|TransportationTech (Seed)|Marketplaces (Series A)"],
  ["Thomas Lueke", "Cherry Ventures", "Partner", "$2.6M", "$580K – $4.6M", "Berlin, Germany", "SMB Software (Seed)|E-commerce (Series A)|SMB Software (Series A)"],
  ["Ali Qaiser", "Hambro Perks", "Managing Director", "$7.5M", "$5M – $10M", "London", "Human Capital/HRTech (Seed)|Consumer Health (Series B)|Education (Series B)"],
  ["Will Weisman", "KittyHawk Ventures", "Managing Partner", "$2M", "$250K – $15M", "New York, New York|Warsaw, Poland", "Medical Devices (Seed)|Robotics (Seed)|TransportationTech (Series A)"],
  ["Derick En'Wezoh", "Susa Ventures", "Investor", "$1.3M", "$1M – $1.5M", "San Francisco Bay Area", "Consumer Health (Series A)|Consumer Health (Seed)|AI (Seed)"],
  ["Pratyush Buddiga", "Susa Ventures", "Investor", "$1.3M", "$1M – $1.5M", "San Francisco, California", "Education (Series A)|Education (Seed)|Education (Pre-seed)"],
];

const ROWS: Row[] = [...CORE_ROWS, ...MORE_PRESEED, ...ASIA_PRESEED, ...CANADA];

function toRecord(row: Row): InvestorRecord {
  const [name, firm, title, sweet, range, locs, focuses, batch] = row;
  const { min, max } = parseRange(range);
  const focus_areas = parseFocus(focuses.split("|").map((s) => s.trim()).filter(Boolean));
  const locations = locs
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s && s !== "—");
  const stages = [...new Set(focus_areas.map((f) => f.stage))];
  const base: InvestorRecord = {
    id: slugifyInvestor(name, firm),
    name,
    firm,
    title,
    investor_type: inferType(title, firm),
    check_sweet_spot_usd: parseMoney(sweet),
    check_min_usd: min,
    check_max_usd: max,
    locations,
    focus_areas,
    stages,
    status: "active",
    verification: { state: "unverified", last_checked_at: null, notes: "" },
    links: { linkedin: null, firm: null, profile: null },
    source_batch: (batch && BATCH_LABELS[batch]) || "user_seed_2026",
  };
  base.status = deriveStatus(base);
  return base;
}

const byId = new Map<string, InvestorRecord>();
let skippedUnknown = 0;
let skippedNeedsReview = 0;
for (const row of ROWS) {
  if (/^unknown$/i.test(row[2]?.trim() ?? "")) {
    skippedUnknown += 1;
    continue;
  }
  const rec = toRecord(row);
  if (rec.status === "needs_review") {
    skippedNeedsReview += 1;
    continue;
  }
  if (!byId.has(rec.id)) byId.set(rec.id, rec);
}

const file: InvestorsFile = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  investors: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)),
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = join(__dirname, "..", "data", "investors.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(file, null, 2), "utf8");
console.log(`Wrote ${file.investors.length} investors → ${out}`);
console.log(`skipped Unknown title=${skippedUnknown} needs_review=${skippedNeedsReview}`);
console.log(
  `active=${file.investors.filter((i) => i.status === "active").length} needs_review=${file.investors.filter((i) => i.status === "needs_review").length}`,
);
const batches = file.investors.reduce<Record<string, number>>((acc, i) => {
  acc[i.source_batch] = (acc[i.source_batch] ?? 0) + 1;
  return acc;
}, {});
console.log("batches:", batches);
