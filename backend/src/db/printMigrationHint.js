#!/usr/bin/env node
/**
 * Affiche comment appliquer la migration initiale (le push direct Postgres
 * échoue souvent en IPv6 depuis certains réseaux).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const projectId = process.env.SUPABASE_PROJECT_ID || 'kiggmajeihmdkzdhjrwb';
const migration = path.join(__dirname, '../../../supabase/migrations/20260915000000_init.sql');

console.log('=== Migration Supabase HEXARO ===');
console.log('');
console.log('1. Ouvre le SQL Editor :');
console.log(`   https://supabase.com/dashboard/project/${projectId}/sql/new`);
console.log('');
console.log('2. Colle le fichier :');
console.log(`   ${migration}`);
console.log('');
console.log('3. Clique Run');
console.log('');
console.log('4. Auth → Providers : active Email');
console.log('   (désactive "Confirm email" en local pour tester plus vite)');
console.log('');
console.log('5. Dans backend/.env, renseigne ADMIN_EMAIL=ton@email.com');
console.log('   Puis crée ce compte via /register — il sera promu admin au login.');
console.log('');
console.log('6. Relance backend + frontend :');
console.log('   cd backend && npm run dev');
console.log('   cd frontend && npm run dev');
