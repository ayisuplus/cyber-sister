import 'dotenv/config'

import { loadRuntimeSecrets, validateRuntimeConfig } from './config/runtime.js'

loadRuntimeSecrets()
validateRuntimeConfig()
await import('./app.js')
