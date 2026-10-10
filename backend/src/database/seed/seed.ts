import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Phase 2.6B: seeding now requires an Organization to attach the admin,
 * departments, and devices to — mirrors the same default org Migration 1
 * (20260908235500_add_organization_foundation) created for backfilling
 * pre-existing data. Looked up/created by slug rather than a hardcoded id
 * so this works correctly both against the already-migrated dev database
 * (where this row already exists) and against a genuinely fresh database
 * that only ran `prisma migrate deploy` + this seed script.
 *
 * SEED_ORGANIZATION_NAME/SEED_ORGANIZATION_SLUG (optional) let a packaged
 * environment — the evaluator demo stack in infra/demo — seed its admin,
 * departments and devices into its own clearly-named organization
 * ("Mirqab Demo Organization"). Unset, behavior is exactly as before.
 */
async function seedDefaultOrganization(): Promise<string> {
  const slug = process.env.SEED_ORGANIZATION_SLUG || 'default-organization';
  const name = process.env.SEED_ORGANIZATION_NAME || 'Default Organization';
  const organization = await prisma.organization.upsert({
    where: { slug },
    create: { name, slug },
    update: {},
  });
  return organization.id;
}

async function seedAdmin(organizationId: string): Promise<void> {
  const email = process.env.ADMIN_EMAIL ?? 'admin@mirqab.local';
  const password = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';
  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS ?? 12);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin user ${email} already exists — skipping.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, saltRounds);

  await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName: 'System',
      lastName: 'Administrator',
      role: Role.ADMIN,
      organizationId,
    },
  });

  console.log(`Seeded initial admin user: ${email}`);
}

const DEPARTMENT_NAMES = [
  'Finance',
  'Human Resources',
  'IT Operations',
  'Sales & Marketing',
  'Engineering',
];

/** Same 15 virtual devices the Phase 4 dashboard used client-side — now the real, shared source of truth. */
const DEVICE_SEED: Array<{
  hostname: string;
  department: string;
  os: string;
  ipAddress: string;
  baselineScore: number;
}> = [
  {
    hostname: 'FIN-WKS-01',
    department: 'Finance',
    os: 'Windows 11',
    ipAddress: '10.10.1.11',
    baselineScore: 88,
  },
  {
    hostname: 'FIN-WKS-02',
    department: 'Finance',
    os: 'Windows 11',
    ipAddress: '10.10.1.12',
    baselineScore: 84,
  },
  {
    hostname: 'FIN-LAP-01',
    department: 'Finance',
    os: 'Windows 10',
    ipAddress: '10.10.1.13',
    baselineScore: 76,
  },
  {
    hostname: 'HR-WKS-01',
    department: 'Human Resources',
    os: 'Windows 11',
    ipAddress: '10.10.2.11',
    baselineScore: 91,
  },
  {
    hostname: 'HR-WKS-02',
    department: 'Human Resources',
    os: 'Windows 11',
    ipAddress: '10.10.2.12',
    baselineScore: 82,
  },
  {
    hostname: 'IT-SRV-01',
    department: 'IT Operations',
    os: 'Windows Server 2022',
    ipAddress: '10.10.3.10',
    baselineScore: 95,
  },
  {
    hostname: 'IT-WKS-01',
    department: 'IT Operations',
    os: 'Windows 11',
    ipAddress: '10.10.3.11',
    baselineScore: 90,
  },
  {
    hostname: 'IT-WKS-02',
    department: 'IT Operations',
    os: 'Windows 11',
    ipAddress: '10.10.3.12',
    baselineScore: 87,
  },
  {
    hostname: 'SALES-LAP-01',
    department: 'Sales & Marketing',
    os: 'Windows 11',
    ipAddress: '10.10.4.11',
    baselineScore: 79,
  },
  {
    hostname: 'SALES-LAP-02',
    department: 'Sales & Marketing',
    os: 'Windows 10',
    ipAddress: '10.10.4.12',
    baselineScore: 73,
  },
  {
    hostname: 'SALES-WKS-01',
    department: 'Sales & Marketing',
    os: 'Windows 11',
    ipAddress: '10.10.4.13',
    baselineScore: 81,
  },
  {
    hostname: 'ENG-WKS-01',
    department: 'Engineering',
    os: 'Windows 11',
    ipAddress: '10.10.5.11',
    baselineScore: 89,
  },
  {
    hostname: 'ENG-WKS-02',
    department: 'Engineering',
    os: 'Windows 11',
    ipAddress: '10.10.5.12',
    baselineScore: 85,
  },
  {
    hostname: 'ENG-SRV-01',
    department: 'Engineering',
    os: 'Ubuntu Server 22.04',
    ipAddress: '10.10.5.10',
    baselineScore: 93,
  },
  {
    hostname: 'ENG-LAP-01',
    department: 'Engineering',
    os: 'Windows 11',
    ipAddress: '10.10.5.13',
    baselineScore: 80,
  },
];

async function seedDepartmentsAndDevices(organizationId: string): Promise<void> {
  const departmentIdByName = new Map<string, string>();

  for (const name of DEPARTMENT_NAMES) {
    // Phase 2.6B: departments are now uniquely keyed by (organizationId,
    // name), not name alone — see schema.prisma's Department model.
    const department = await prisma.department.upsert({
      where: { organizationId_name: { organizationId, name } },
      create: { name, organizationId },
      update: {},
    });
    departmentIdByName.set(name, department.id);
  }
  console.log(`Seeded ${DEPARTMENT_NAMES.length} departments.`);

  for (const device of DEVICE_SEED) {
    const departmentId = departmentIdByName.get(device.department);
    if (!departmentId) continue;

    await prisma.device.upsert({
      where: { hostname: device.hostname },
      create: {
        hostname: device.hostname,
        departmentId,
        organizationId,
        os: device.os,
        ipAddress: device.ipAddress,
        baselineScore: device.baselineScore,
      },
      update: {
        os: device.os,
        ipAddress: device.ipAddress,
        baselineScore: device.baselineScore,
      },
    });
  }
  console.log(`Seeded ${DEVICE_SEED.length} virtual devices.`);
}

const POLICY_SEED: Array<{
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  compliancePercent: number;
}> = [
  {
    name: 'Password Policy',
    description: 'Minimum 12 characters, complexity required, rotated every 90 days.',
    category: 'Identity',
    enabled: true,
    compliancePercent: 94,
  },
  {
    name: 'MFA Enforcement',
    description: 'Multi-factor authentication required for all accounts with SOC Dashboard access.',
    category: 'Identity',
    enabled: true,
    compliancePercent: 100,
  },
  {
    name: 'USB Device Control',
    description: 'Blocks unauthorized USB mass-storage devices on managed endpoints.',
    category: 'Endpoint',
    enabled: true,
    compliancePercent: 88,
  },
  {
    name: 'Patch Management',
    description: 'Critical OS and application patches applied within 7 days of release.',
    category: 'Endpoint',
    enabled: true,
    compliancePercent: 81,
  },
  {
    name: 'Endpoint Firewall Baseline',
    description: 'Host firewall must be enabled on all network profiles for every managed device.',
    category: 'Network',
    enabled: true,
    compliancePercent: 90,
  },
  {
    name: 'Data Loss Prevention',
    description: 'Blocks upload of documents tagged confidential to unmanaged cloud storage.',
    category: 'Data',
    enabled: false,
    compliancePercent: 62,
  },
  {
    // DEPRECATED — no longer read by any execution path. The 3-minute
    // similarity-gated isolation it controlled was removed in favour of the
    // single 5-minute response window below (see
    // backend/src/modules/ai/response-sla). Kept so existing databases keep
    // their historical row unchanged (the upsert below never updates an
    // existing row) and fresh databases stay consistent with them. Created
    // disabled on a fresh database so the Policies page never shows an
    // inert, deprecated control as "on".
    name: 'AI Auto-Response (3-Minute Isolation Window)',
    description:
      'Allows the system to automatically isolate a device after a 3-minute window when a high-confidence historical match shows a strong isolation success record and no analyst has acted. Disable to require manual approval in all cases.',
    category: 'Response',
    enabled: false,
    compliancePercent: 100,
  },
  {
    // Name must match RESPONSE_WINDOW_POLICY_NAME in
    // backend/src/modules/ai/response-sla/response-sla.constants.ts exactly —
    // ResponseSlaService looks it up by name as the operator kill switch
    // (fail-closed: a missing row means automated containment is off). Even
    // when enabled, containment only executes when an endpoint-control
    // provider is actually configured.
    name: '5-Minute Response Window',
    description:
      'HIGH/CRITICAL incidents must be acknowledged within 5 minutes of detection. If no one responds, the affected endpoint is automatically isolated through the configured endpoint-control provider (Wazuh Active Response), and the result is verified before it is reported. Disable to never isolate automatically.',
    category: 'Response',
    enabled: true,
    compliancePercent: 100,
  },
];

async function seedPolicies(): Promise<void> {
  for (const policy of POLICY_SEED) {
    await prisma.policy.upsert({
      where: { name: policy.name },
      create: policy,
      update: {},
    });
  }
  console.log(`Seeded ${POLICY_SEED.length} policies.`);
}

async function main(): Promise<void> {
  const organizationId = await seedDefaultOrganization();
  await seedAdmin(organizationId);
  await seedDepartmentsAndDevices(organizationId);
  await seedPolicies();
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
