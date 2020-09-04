import KeywordContext from "../compile/context"
import {noPropertyInData} from "./util"
import {_, or, Code, Name} from "../compile/codegen"

export function checkReportMissingProp(cxt: KeywordContext, prop: string): void {
  const {gen, data, it} = cxt
  gen.if(noPropertyInData(data, prop, it.opts.ownProperties), () => {
    cxt.setParams({missingProperty: _`${prop}`}, true)
    cxt.error()
  })
}

export function checkMissingProp(
  {data, it: {opts}}: KeywordContext,
  properties: string[],
  missing: Name
): Code {
  return or(
    ...properties.map(
      (prop) => _`(${noPropertyInData(data, prop, opts.ownProperties)} && (${missing} = ${prop}))`
    )
  )
}

export function reportMissingProp(cxt: KeywordContext, missing: Name): void {
  cxt.setParams({missingProperty: missing}, true)
  cxt.error()
}