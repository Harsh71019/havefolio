export interface BreakingChange {
  rule: string;
  location: string;
  message: string;
}

export interface CompatibilityResult {
  compatible: boolean;
  breakingChanges: BreakingChange[];
}

export interface OpenApiSchema {
  type?: string;
  $ref?: string;
  nullable?: boolean;
  required?: string[];
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
  enum?: unknown[];
  oneOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
  allOf?: OpenApiSchema[];
}

export interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: OpenApiSchema;
}

export interface OpenApiOperation {
  parameters?: OpenApiParameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: OpenApiSchema }>;
  };
  responses?: Record<
    string,
    { description?: string; content?: Record<string, { schema?: OpenApiSchema }> }
  >;
}

export function checkOpenApiCompatibility(
  baseline: Record<string, unknown>,
  candidate: Record<string, unknown>,
): CompatibilityResult {
  const breakingChanges: BreakingChange[] = [];

  const resolve = (
    spec: Record<string, unknown>,
    schema?: OpenApiSchema,
  ): OpenApiSchema | undefined => {
    if (!schema) return undefined;
    if (schema.$ref) {
      const parts = schema.$ref.replace(/^#\//, '').split('/');
      let current: unknown = spec;
      for (const part of parts) {
        if (typeof current === 'object' && current !== null && part in current) {
          current = (current as Record<string, unknown>)[part];
        } else {
          current = undefined;
          break;
        }
      }
      return current ? resolve(spec, current) : undefined;
    }
    return schema;
  };

  const baselinePaths =
    (baseline.paths as Record<string, Record<string, OpenApiOperation>> | undefined) ?? {};
  const candidatePaths =
    (candidate.paths as Record<string, Record<string, OpenApiOperation>> | undefined) ?? {};

  for (const [pathKey, baselinePathItem] of Object.entries(baselinePaths)) {
    const candidatePathItem = candidatePaths[pathKey];
    if (!candidatePathItem) {
      breakingChanges.push({
        rule: 'PATH_REMOVED',
        location: pathKey,
        message: `Endpoint ${pathKey} was removed from the API contract.`,
      });
      continue;
    }

    const httpMethods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
    for (const method of httpMethods) {
      const baselineOp: OpenApiOperation | undefined = baselinePathItem[method];
      if (!baselineOp) continue;

      const candidateOp: OpenApiOperation | undefined = candidatePathItem[method];
      if (!candidateOp) {
        breakingChanges.push({
          rule: 'METHOD_REMOVED',
          location: `${method.toUpperCase()} ${pathKey}`,
          message: `HTTP method ${method.toUpperCase()} was removed from ${pathKey}.`,
        });
        continue;
      }

      const opLocation = `${method.toUpperCase()} ${pathKey}`;

      // 1. Parameter comparisons
      const baselineParams = baselineOp.parameters ?? [];
      const candidateParams = candidateOp.parameters ?? [];

      const baselineParamMap = new Map<string, OpenApiParameter>();
      for (const p of baselineParams) {
        baselineParamMap.set(`${p.in}:${p.name}`, p);
      }

      const candidateParamMap = new Map<string, OpenApiParameter>();
      for (const p of candidateParams) {
        candidateParamMap.set(`${p.in}:${p.name}`, p);
      }

      // Check for removed parameters or changed parameter types/required
      for (const [key, baseP] of baselineParamMap.entries()) {
        const candP = candidateParamMap.get(key);
        if (!candP) {
          if (baseP.in === 'path') {
            breakingChanges.push({
              rule: 'PATH_PARAMETER_REMOVED',
              location: `${opLocation} (param ${baseP.name} in ${baseP.in})`,
              message: `Path parameter ${baseP.name} was removed.`,
            });
          }
          continue;
        }

        // Did optional parameter become required?
        if (!baseP.required && candP.required) {
          breakingChanges.push({
            rule: 'PARAMETER_REQUIRED_CHANGED',
            location: `${opLocation} (param ${baseP.name} in ${baseP.in})`,
            message: `Parameter ${baseP.name} in ${baseP.in} changed from optional to required.`,
          });
        }

        // Did parameter type change?
        const baseSchema = resolve(baseline, baseP.schema);
        const candSchema = resolve(candidate, candP.schema);
        if (baseSchema?.type && candSchema?.type && baseSchema.type !== candSchema.type) {
          breakingChanges.push({
            rule: 'PARAMETER_TYPE_CHANGED',
            location: `${opLocation} (param ${baseP.name} in ${baseP.in})`,
            message: `Parameter ${baseP.name} schema type changed from ${baseSchema.type} to ${candSchema.type}.`,
          });
        }
      }

      // Check for new required parameters
      for (const [key, candP] of candidateParamMap.entries()) {
        if (!baselineParamMap.has(key) && candP.required) {
          breakingChanges.push({
            rule: 'REQUIRED_PARAMETER_ADDED',
            location: `${opLocation} (param ${candP.name} in ${candP.in})`,
            message: `A new required parameter ${candP.name} in ${candP.in} was added to ${opLocation}.`,
          });
        }
      }

      // 2. Request body comparisons
      const baseReqBody = baselineOp.requestBody;
      const candReqBody = candidateOp.requestBody;

      if (!baseReqBody?.required && candReqBody?.required) {
        breakingChanges.push({
          rule: 'REQUEST_BODY_REQUIRED_CHANGED',
          location: opLocation,
          message: `Request body changed from optional to required on ${opLocation}.`,
        });
      }

      if (baseReqBody?.content && candReqBody?.content) {
        for (const [contentType, baseMediaType] of Object.entries(baseReqBody.content)) {
          const candMediaType = candReqBody.content[contentType];
          if (!candMediaType) {
            breakingChanges.push({
              rule: 'REQUEST_BODY_CONTENT_TYPE_REMOVED',
              location: `${opLocation} (${contentType})`,
              message: `Content type ${contentType} for request body was removed from ${opLocation}.`,
            });
            continue;
          }

          const baseSchema = resolve(baseline, baseMediaType.schema);
          const candSchema = resolve(candidate, candMediaType.schema);
          checkSchemaCompatibility(
            baseline,
            candidate,
            baseSchema,
            candSchema,
            `${opLocation} request body`,
            'request',
            breakingChanges,
            resolve,
          );
        }
      }

      // 3. Responses comparisons
      const baseResponses = baselineOp.responses ?? {};
      const candResponses = candidateOp.responses ?? {};

      for (const [statusCode, baseResp] of Object.entries(baseResponses)) {
        // We care about existing successful/expected status codes
        const candResp = candResponses[statusCode];
        if (!candResp) {
          // Removing a 2xx or 3xx or documented 4xx is breaking
          if (statusCode.startsWith('2') || statusCode === 'default') {
            breakingChanges.push({
              rule: 'RESPONSE_STATUS_REMOVED',
              location: `${opLocation} -> ${statusCode}`,
              message: `Documented response status ${statusCode} was removed from ${opLocation}.`,
            });
          }
          continue;
        }

        if (baseResp.content && candResp.content) {
          for (const [contentType, baseMediaType] of Object.entries(baseResp.content)) {
            const candMediaType = candResp.content[contentType];
            if (!candMediaType) {
              breakingChanges.push({
                rule: 'RESPONSE_CONTENT_TYPE_REMOVED',
                location: `${opLocation} -> ${statusCode} (${contentType})`,
                message: `Content type ${contentType} for response ${statusCode} was removed.`,
              });
              continue;
            }

            const baseSchema = resolve(baseline, baseMediaType.schema);
            const candSchema = resolve(candidate, candMediaType.schema);
            checkSchemaCompatibility(
              baseline,
              candidate,
              baseSchema,
              candSchema,
              `${opLocation} -> ${statusCode} response`,
              'response',
              breakingChanges,
              resolve,
            );
          }
        }
      }
    }
  }

  return {
    compatible: breakingChanges.length === 0,
    breakingChanges,
  };
}

function checkSchemaCompatibility(
  baselineSpec: Record<string, unknown>,
  candidateSpec: Record<string, unknown>,
  baseSchema: OpenApiSchema | undefined,
  candSchema: OpenApiSchema | undefined,
  location: string,
  mode: 'request' | 'response',
  breakingChanges: BreakingChange[],
  resolve: (spec: Record<string, unknown>, s?: OpenApiSchema) => OpenApiSchema | undefined,
  visited = new Set<string>(),
): void {
  if (!baseSchema || !candSchema) return;

  // Handle allOf merging if present
  if (baseSchema.allOf) {
    const mergedBase: OpenApiSchema = { type: 'object', properties: {}, required: [] };
    for (const s of baseSchema.allOf) {
      const resolved = resolve(baselineSpec, s);
      if (resolved?.properties) Object.assign(mergedBase.properties!, resolved.properties);
      if (resolved?.required) mergedBase.required!.push(...resolved.required);
    }
    baseSchema = mergedBase;
  }
  if (candSchema.allOf) {
    const mergedCand: OpenApiSchema = { type: 'object', properties: {}, required: [] };
    for (const s of candSchema.allOf) {
      const resolved = resolve(candidateSpec, s);
      if (resolved?.properties) Object.assign(mergedCand.properties!, resolved.properties);
      if (resolved?.required) mergedCand.required!.push(...resolved.required);
    }
    candSchema = mergedCand;
  }

  // Type change
  if (baseSchema.type && candSchema.type && baseSchema.type !== candSchema.type) {
    breakingChanges.push({
      rule: `${mode.toUpperCase()}_SCHEMA_TYPE_CHANGED`,
      location,
      message: `${mode === 'request' ? 'Request' : 'Response'} schema type changed from ${baseSchema.type} to ${candSchema.type}.`,
    });
    return;
  }

  // Nullability change in response: previously non-nullable became nullable
  if (mode === 'response' && !baseSchema.nullable && candSchema.nullable) {
    breakingChanges.push({
      rule: 'RESPONSE_FIELD_NULLABILITY_EXPANDED',
      location,
      message: `Response schema became nullable where previously non-null.`,
    });
  }

  // Request mode: New required fields in request body are BREAKING
  if (mode === 'request') {
    const baseReqSet = new Set(baseSchema.required ?? []);
    const candReqSet = new Set(candSchema.required ?? []);
    for (const reqField of candReqSet) {
      if (!baseReqSet.has(reqField)) {
        breakingChanges.push({
          rule: 'REQUEST_BODY_REQUIRED_FIELD_ADDED',
          location: `${location}.${reqField}`,
          message: `New required property ${reqField} was added to request schema.`,
        });
      }
    }
  }

  // Response mode: Removed fields
  if (mode === 'response' && baseSchema.properties) {
    const candProps = candSchema.properties ?? {};
    for (const propName of Object.keys(baseSchema.properties)) {
      if (!(propName in candProps)) {
        breakingChanges.push({
          rule: 'RESPONSE_FIELD_REMOVED',
          location: `${location}.${propName}`,
          message: `Property ${propName} was removed from response schema.`,
        });
      }
    }
  }

  // Enum values
  if (baseSchema.enum && candSchema.enum) {
    const candEnumSet = new Set(candSchema.enum);
    for (const val of baseSchema.enum) {
      if (!candEnumSet.has(val)) {
        breakingChanges.push({
          rule: `${mode.toUpperCase()}_ENUM_VALUE_REMOVED`,
          location,
          message: `Enum value "${String(val)}" was removed from ${mode} schema.`,
        });
      }
    }
  }

  // Array items
  if (baseSchema.type === 'array' && baseSchema.items && candSchema.items) {
    const resolvedBase = resolve(baselineSpec, baseSchema.items);
    const resolvedCand = resolve(candidateSpec, candSchema.items);
    checkSchemaCompatibility(
      baselineSpec,
      candidateSpec,
      resolvedBase,
      resolvedCand,
      `${location}[]`,
      mode,
      breakingChanges,
      resolve,
      visited,
    );
  }

  // Object properties comparison
  if (baseSchema.properties && candSchema.properties) {
    for (const [propName, baseProp] of Object.entries(baseSchema.properties)) {
      const candProp = candSchema.properties[propName];
      if (!candProp) continue;

      const visitKey = `${location}.${propName}`;
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);

      const resolvedBase = resolve(baselineSpec, baseProp);
      const resolvedCand = resolve(candidateSpec, candProp);
      checkSchemaCompatibility(
        baselineSpec,
        candidateSpec,
        resolvedBase,
        resolvedCand,
        visitKey,
        mode,
        breakingChanges,
        resolve,
        visited,
      );
    }
  }
}
