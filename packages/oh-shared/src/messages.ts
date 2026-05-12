export const messages = {
  starting: (project: string) => `Iniciando proceso para el proyecto ${project}...`,
  ready: "Listo, ya puedes empezar a escribir.",
  closed: (project: string) => `Cerré la sesión del proyecto ${project}.`,
  evicted: (project: string) => `Cerré la sesión del proyecto ${project} por inactividad.`,
  switched: (prev: string, next: string) => `Cambié del proyecto ${prev} al proyecto ${next}.`,
  spawned: (project: string) => `Sesión del proyecto ${project} lista.`,
  listEmpty: "No tienes sesiones activas en este momento.",
  list: (items: string[]) => `Sesiones activas:\n${items.map((i) => `- ${i}`).join("\n")}`,
  parseFailed: "No entendí la instrucción. ¿Puedes reformularla?",
  spawnFailed: (project: string) => `No pude iniciar el proceso para el proyecto ${project}. Intenta de nuevo.`,
  unbound: "Aún no has vinculado este canal a tu identidad. Usa el comando de pareo.",
}
