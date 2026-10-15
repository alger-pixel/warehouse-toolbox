const READ_ONLY_POST_ROUTES = new Set([
  'ai-command',
  'b044-prepare',
  'b044-recover',
  'b044-reconcile',
  'b044-reconcile-diagnose',
  'client-search',
  'inventory-lookup',
  'inventory-search',
  'location-move-lookup',
  'lookup',
  'picking-detail',
  'picking-search',
  'tineco-inventory',
  'users-get',
  'users-list',
  'users-tools'
]);

export function isMutationRequest(route, routeMatch, method) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
  if (route === 'projects' || route === 'cases' || route === 'case-categories') return true;
  return !READ_ONLY_POST_ROUTES.has(route);
}

export function productionMutationAllowed(request, env) {
  if (env.FEISHU_DATA_ENVIRONMENT !== 'production') return true;
  return env.WORKER_RUNTIME_ENVIRONMENT === 'production'
    && Boolean(request.cf)
    && typeof env.PRODUCTION_MUTATION_AUTHORIZATION === 'string'
    && env.PRODUCTION_MUTATION_AUTHORIZATION.length >= 32;
}

export function shouldBlockProductionMutation(request, env, route, routeMatch) {
  return isMutationRequest(route, routeMatch, request.method) && !productionMutationAllowed(request, env);
}
