# LESSONS LEARNED & ARCHITECTURAL INVARIANTS

Este archivo registra las lecciones aprendidas, invariantes técnicas y patrones de arquitectura descubiertos en el desarrollo del proyecto.

> **Regla de Operación**: Debe ser **consultado al iniciar** cualquier tarea y **actualizado al finalizar**, antes de solicitar la aprobación del usuario para la entrega git.

---

## 1. Invariantes de Arquitectura y Contratos

*(Registrá aquí contratos cerrados, convenciones de interfaz y decisiones de diseño que no deben reabrirse ni revertirse sin consulta explícita).*

- **Contratos de Interfaz**: Las interfaces públicas son el límite de prueba (seam). Si una prueba requiere inspeccionar el estado interno de un módulo, la abstracción es incorrecta.
- **Manejo de Secretos**: Ningún token, contraseña ni clave privada se escribe en código fuente ni se commitea en git. Todas las credenciales se inyectan mediante `.env` (ignorado en `.gitignore`).

---

## 2. Integraciones Externas y Protocolos

*(Registrá aquí peculiaridades de APIs externas, modelos LLM, bases de datos o servicios de red).*

- **Determinismo en Tests de LLM**: Las pruebas automatizadas nunca deben depender de llamadas en vivo a APIs de modelos con muestreo no determinista. Usar siempre mocks, stubs o fixtures grabados.
- **Timeouts y Circuit Breakers**: Toda llamada HTTP saliente a servicios externos debe definir un timeout explícito y un mecanismo de corte ante fallos reiterados.

---

## 3. Rendimiento, Recursos y Almacenamiento

*(Registrá aquí presupuestos de memoria, restricciones de CPU o límites de concurrencia).*

- **Presupuesto de Memoria**: Validar que la huella de memoria acumulada de los servicios no exceda el límite operativo del entorno anfitrión.
- **Persistencia Aislada**: Los volúmenes y rutas de almacenamiento persistente deben declararse explícitamente sin montar directorios raíz del anfitrión.

---

## 4. Protocolo de Mantenimiento

1. **Consulta Obligatoria**: El agente **DEBE** leer este archivo antes de comenzar a escribir código o diagnosticar un error.
2. **Registro Inmediato**: Al descubrir un bug no obvio, una trampa de configuración o una decisión arquitectónica duradera, el agente **DEBE** registrarla en este archivo en el paso 6 del flujo principal (`dev-protocol`).
