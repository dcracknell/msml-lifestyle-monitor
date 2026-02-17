const ROLES = {
  HEAD_COACH: 'Head Coach',
  COACH: 'Coach',
  ATHLETE: 'Athlete',
};

const ROLE_ALIASES = new Map(
  [
    ['head coach', ROLES.HEAD_COACH],
    ['coach', ROLES.COACH],
    ['performance coach', ROLES.COACH],
    ['wellness lead', ROLES.COACH],
    ['athlete', ROLES.ATHLETE],
  ]
);

function normalizeRole(role = '') {
  if (!role) return null;
  const key = role.toString().trim().toLowerCase();
  return ROLE_ALIASES.get(key) || null;
}

function coerceRole(role, fallback = ROLES.ATHLETE) {
  return normalizeRole(role) || fallback;
}

function isHeadCoach(role = '') {
  return coerceRole(role) === ROLES.HEAD_COACH;
}

function isCoach(role = '') {
  const normalized = coerceRole(role);
  return normalized === ROLES.HEAD_COACH || normalized === ROLES.COACH;
}

function isAthlete(role = '') {
  return coerceRole(role) === ROLES.ATHLETE;
}

function classifyRole(role = '') {
  if (isHeadCoach(role)) return 'head';
  if (isCoach(role)) return 'coach';
  return 'athlete';
}

module.exports = {
  ROLES,
  normalizeRole,
  coerceRole,
  isHeadCoach,
  isCoach,
  isAthlete,
  classifyRole,
};
