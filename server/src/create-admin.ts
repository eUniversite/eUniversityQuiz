import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { prisma } from './db.js'

// Usage : npm run admin:create -- email@exemple.ci "Nom Prénom"
// Le mot de passe vient de ADMIN_PASSWORD (12 caractères minimum) ; sinon un mot de passe fort est généré et affiché une seule fois.
const [email, name] = process.argv.slice(2)
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error('Usage : npm run admin:create -- email@exemple.ci "Nom Prénom"'); process.exit(1) }
const given = process.env.ADMIN_PASSWORD
if (given && given.length < 12) { console.error('ADMIN_PASSWORD : 12 caractères minimum.'); process.exit(1) }
const password = given || randomBytes(12).toString('base64url')
const e = email.toLowerCase()
const exists = await prisma.admin.findUnique({ where: { email: e } })
const data = { name: name || exists?.name || e.split('@')[0], passwordHash: await bcrypt.hash(password, 12), passwordChangedAt: new Date(Date.now() + 1000), disabledAt: null }
await prisma.admin.upsert({ where: { email: e }, update: data, create: { email: e, ...data } })
console.log(`${exists ? 'Mot de passe réinitialisé' : 'Administrateur créé'} : ${e}`)
if (!given) console.log(`Mot de passe (à changer après la première connexion) : ${password}`)
await prisma.$disconnect()
