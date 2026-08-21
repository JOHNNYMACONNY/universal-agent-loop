import { handleActionRequest as handleCoreActionRequest } from './app.mjs';
import {
  gameBrowserOpenApiPaths,
  gameBrowserOpenApiSchemas,
  handleGameBrowserControlRequest,
} from './game-browser-control.mjs';

const security = [{ bearerAuth: [] }];

function withGameBrowserSchema(response) {
  if (response.status !== 200 || !response.body || typeof response.body !== 'object') return response;
  return {
    ...response,
    body: {
      ...response.body,
      info: {
        ...response.body.info,
        version: '0.4.0',
        description: 'Private GPT Action for canonical Universal Agent Loop skills, bounded GitHub repository control, and bounded remote game-browser QA.',
      },
      paths: {
        ...response.body.paths,
        ...gameBrowserOpenApiPaths(security),
      },
      components: {
        ...response.body.components,
        schemas: {
          ...response.body.components?.schemas,
          ...gameBrowserOpenApiSchemas,
        },
      },
    },
  };
}

export async function handleActionRequest(request, options = {}) {
  const path = String(request?.path ?? '/');

  if (path === '/openapi.json') {
    return withGameBrowserSchema(await handleCoreActionRequest(request, options));
  }

  if (path.startsWith('/game-browser/')) {
    // Reuse the core Action authentication boundary. A valid bearer reaches the
    // core 404 because game-browser routes are intentionally owned by this
    // composition layer; auth/configuration failures return before that point.
    const authProbe = await handleCoreActionRequest(request, options);
    if (authProbe.status !== 404) return authProbe;
    return handleGameBrowserControlRequest(request, options);
  }

  return handleCoreActionRequest(request, options);
}
