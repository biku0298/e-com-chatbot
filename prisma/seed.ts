import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../app/generated/prisma/client';
import { faker } from '@faker-js/faker';
import 'dotenv/config';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const categories = ['topwear', 'bottomwear'] as const;
const typesByGenderCategory = {
  boys: { topwear: ['shirt'], bottomwear: ['shorts', 'jeans'] },
  girls: { topwear: ['top'], bottomwear: ['skirt', 'dress'] },
};
const genders = ['boys', 'girls'] as const;
const colors = ['red', 'blue', 'green', 'yellow', 'black', 'white', 'pink', 'grey'];
const fits = ['regular', 'slim', 'relaxed'];
const sizes = ['2-3Y', '4-5Y', '6-7Y', '8-9Y', '10-12Y'];
const ageRanges = [
  { minAge: 1, maxAge: 2 },
  { minAge: 3, maxAge: 5 },
  { minAge: 6, maxAge: 8 },
  { minAge: 9, maxAge: 12 },
];

async function main() {
  const products = [];

  for (let i = 0; i < 1000; i++) {
    const gender = faker.helpers.arrayElement(genders);
    const category = faker.helpers.arrayElement(categories);
    const type = faker.helpers.arrayElement(typesByGenderCategory[gender][category]);
    const color = faker.helpers.arrayElement(colors);
    const { minAge, maxAge } = faker.helpers.arrayElement(ageRanges);

    products.push({
      name: `${color} ${type} for kids`,
      description: `A comfortable ${color} ${type}, perfect for everyday wear.`,
      category,
      type,
      gender,
      minAge,
      maxAge,
      color,
      fit: faker.helpers.arrayElement(fits),
      size: faker.helpers.arrayElement(sizes),
      price: faker.number.int({ min: 199, max: 1499 }),
      imageUrl: `https://placehold.co/300x300?text=${type}`,
    });
  }

  await prisma.product.createMany({ data: products });
  console.log(`Seeded ${products.length} products.`);
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());
