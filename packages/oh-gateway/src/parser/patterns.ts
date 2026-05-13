import type { Command } from "@openharden/shared"

const slug = "[a-zA-Z0-9][\\w-]*"

const reSwitch = new RegExp(
  `^(?:cambiar(?:me)?\\s+a|cambia\\s+a|c[aá]mbiame\\s+a|trabajar\\s+en|trabaja\\s+en|ir\\s+a|pasar\\s+a|(?:abrir|abre|abra)\\s+(?:el\\s+)?proyecto|switch\\s+to)\\s+(?:proyecto\\s+|project\\s+)?(${slug})`,
  "i",
)

const reClose = new RegExp(
  `^(?:cerrar?|cierra|cierre|terminar?|termina|termine|finalizar?|finaliza|close)(?:\\s+(?:la\\s+)?sesi[oó]n)?(?:\\s+(?:de\\s+)?(?:proyecto|project)\\s+(${slug}))?\\s*$`,
  "i",
)

const reList = /^(?:listar?|lista|muestra|mostrar|qu[eé]\s+(?:tengo|proyectos|sesiones))/i

const reSummary = /^(?:res[uú]me(?:me)?|resumir|resumen|qu[eé]\s+hicimos)/i

export const match = (text: string): Command | null => {
  const t = text.trim()
  if (!t) return null

  const sw = t.match(reSwitch)
  if (sw && sw[1]) return { kind: "switch", project: sw[1] }

  const cl = t.match(reClose)
  if (cl) {
    if (cl[1]) return { kind: "close", project: cl[1] }
    return { kind: "close" }
  }

  if (reList.test(t)) return { kind: "list" }
  if (reSummary.test(t)) return { kind: "summary" }

  return null
}
