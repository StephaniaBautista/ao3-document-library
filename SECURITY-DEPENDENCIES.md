# Seguimiento de dependencias

La auditoría completa con `pnpm audit` mantiene un aviso moderado, GHSA-g3hv-75wg-m249, para `minimatch` 3.1.5, usado por ESLint y sus complementos. La base de avisos marca como afectadas las versiones anteriores a 11.0.1; los paquetes de ESLint instalados todavía solicitan la API de la versión 3. La versión 11 cambia esa API, por lo que forzarla globalmente puede romper el análisis. No se ha ocultado ni excluido el aviso de la auditoría.

El aviso describe una posible denegación de servicio al procesar patrones glob controlados por un atacante. En este proyecto `minimatch` 3 se usa en herramientas de análisis de código, no se importa en las rutas de la aplicación. Ejecutar las herramientas de desarrollo sobre código y configuraciones de confianza limita la exposición, pero esto no demuestra que la dependencia sea invulnerable. La copia utilizada por `@typescript-eslint/typescript-estree` se actualizó a 11.0.1 y su interfaz se verificó con ESLint. Se probó también un adaptador local para las demás dependencias: la regla `import/no-internal-modules` falla porque necesita `makeRe`, que no está disponible en minimatch 11. Una alternativa basada en la comparación directa cambió resultados de patrones glob, por lo que no se aplicó ni se ocultó el aviso. La prueba de compatibilidad se puede ejecutar con `node --test tests/eslint-compat.test.mjs`.

Referencia: https://github.com/advisories/GHSA-g3hv-75wg-m249

Revisar antes del 30 de noviembre de 2026 si ESLint y sus complementos ofrecen una actualización compatible que elimine `minimatch` 3. Volver a ejecutar `pnpm audit` después de cualquier cambio en el archivo de bloqueo.
