# ADR-0001: Node.js 22 + TypeScript + ESM

- **Estado:** aceptado
- **Fecha:** 2026-11-27
- **Decisores:** equipo de backend

## Contexto

El backend necesita un entorno de ejecución y un lenguaje que sostengan una API REST con reglas de negocio extensas (dominio con entidades, puertos y casos de uso), acceso a PostgreSQL, autenticación JWT, procesamiento de CSV en `worker_threads` y dependencias nativas como `argon2`.

Requisitos que condicionan la decisión:

- Tipado estático estricto para detectar errores en reglas de calificación, asistencia y estados de importación antes de llegar a producción.
- Un único sistema de módulos en todo el proyecto, sin convivencia entre `require` e `import` que complique el empaquetado o genere *dual package hazard*.
- Herramientas que ejecuten TypeScript directamente en desarrollo y en scripts, sin etapas de compilación intermedias para cada cambio.
- Compatibilidad con las versiones actuales de Express 5, Vitest, ESLint (configuración plana) y las bibliotecas nativas del proyecto.

## Decisión

Usar **Node.js 22 o superior**, **TypeScript 5.7** y **ESM como único sistema de módulos**.

La configuración resultante es:

- `package.json` declara `"type": "module"` y `"engines": { "node": ">=22" }`.
- `tsconfig.json` usa `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true` y opciones adicionales como `noUncheckedIndexedAccess`, `noImplicitOverride` y `noFallthroughCasesInSwitch`.
- Las importaciones relativas entre archivos TypeScript escriben la extensión `.js` destino (`import { env } from './config/env.js'`), de modo que el código emitido es ejecutable sin reescrituras.
- Desarrollo, migraciones, sembrado, scripts de carga y scripts de importación se ejecutan con `tsx`.
- La compilación de producción usa `tsc -p tsconfig.build.json` con `rootDir: src` y `outDir: dist`; el arranque es `node dist/servidor.js`.
- Las pruebas se ejecutan con Vitest y el análisis estático con ESLint en configuración plana, ambos en ESM.

El código fuente se organiza por capas (`domain`, `application`, `infra`) con inversión de dependencias mediante puertos; esta decisión define solo el entorno de ejecución y el sistema de módulos, no la arquitectura en capas.

## Alternativas consideradas

- **Node.js 20 + CommonJS:** viable y conocido, pero obligaría a renunciar a ESM o a mantener interoperabilidad entre formatos; Node 22 extiende el soporte de la plataforma y alinea las herramientas del proyecto sin esa carga.
- **Node.js 22 + CommonJS:** evita las extensiones `.js` explícitas, pero contradice el sentido de las dependencias actuales y deja el proyecto en un formato en retirada frente a ESM.
- **TypeScript compilado con Babel o ejecutado con `ts-node`:** añade otra herramienta y configuración al flujo; `tsx` y `tsc` cubren desarrollo y producción con menos piezas.
- **JavaScript sin TypeScript:** reduce la configuración inicial, pero pierde la verificación estática de tipos en un dominio con muchas reglas e invariantes.

## Consecuencias

**Positivas**

- Un solo formato de módulos en código, pruebas, scripts y configuración; no hace falta soportar `require` ni conversiones entre formatos.
- El compilador detecta errores de tipos antes de la ejecución (`npm run typecheck`) y el código emitido en `dist/` conserva las rutas relativas tal cual.
- El mismo runtime satisface Express 5, `worker_threads`, bibliotecas nativas y las versiones actuales de las herramientas de prueba y lint.
- `tsx` permite ejecutar scripts de base de datos y de carga directamente desde TypeScript, acortando el ciclo de desarrollo.

**Negativas**

- Las importaciones relativas deben escribirse con extensión `.js` aunque el archivo fuente sea `.ts`; es una convención nueva para quien venga de CommonJS.
- Exigir Node >=22 invalida entornos con versiones anteriores y requiere mantener actualizada la imagen de Docker y la documentación de requisitos.
- `strict` y `noUncheckedIndexedAccess` aumentan el esfuerzo inicial al escribir código y requieren tipos explícitos en los puertos del dominio.

## Verificación

Los archivos que materializan esta decisión son `package.json`, `tsconfig.json`, `tsconfig.build.json` y `eslint.config.js`. Se comprueba con `npm run typecheck`, `npm run build`, `npm run lint` y el arranque de `npm start`.
