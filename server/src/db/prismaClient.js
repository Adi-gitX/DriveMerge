// Lazy initialize PrismaClient so server can still run without installing prisma during PoC
let prisma = null;
let enabled = false;

function tryInit() {
  if (prisma !== null || enabled) return;
  try {
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient();
    enabled = true;
  } catch (err) {
    // Prisma not installed or cannot connect yet.
    prisma = null;
    enabled = false;
  }
}

function isEnabled() {
  tryInit();
  return enabled;
}

function getClient() {
  tryInit();
  if (!enabled) throw new Error('Prisma client not available. Run `yarn` in server and ensure @prisma/client is installed.');
  return prisma;
}

module.exports = { isEnabled, getClient };
