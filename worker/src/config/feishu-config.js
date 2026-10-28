const REQUIRED_KEYS = ["FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_BASE_APP_TOKEN", "FEISHU_PACKAGE_TABLE_ID", "FEISHU_CLIENT_TABLE_ID"];

export function getFeishuConfig(env) {
  const missing = REQUIRED_KEYS.filter((key) => !env || typeof env[key] !== "string" || !env[key].trim());
  if (missing.length) throw new Error(`Missing required Worker bindings: ${missing.join(", ")}`);
  return {
    appId: env.FEISHU_APP_ID.trim(),
    appSecret: env.FEISHU_APP_SECRET,
    appToken: env.FEISHU_BASE_APP_TOKEN.trim(),
    packageTableId: env.FEISHU_PACKAGE_TABLE_ID.trim(),
    clientTableId: env.FEISHU_CLIENT_TABLE_ID.trim(),
    tinecoTocUnitTableId: typeof env.FEISHU_TINECO_TOC_UNIT_TABLE_ID === "string" ? env.FEISHU_TINECO_TOC_UNIT_TABLE_ID.trim() : "",
    userTableId: typeof env.FEISHU_USER_TABLE_ID === "string" ? env.FEISHU_USER_TABLE_ID.trim() : "",
    toolTableId: typeof env.FEISHU_TOOL_TABLE_ID === "string" ? env.FEISHU_TOOL_TABLE_ID.trim() : "",
    pickingListTableId: typeof env.FEISHU_PICKING_LIST_TABLE_ID === "string" ? env.FEISHU_PICKING_LIST_TABLE_ID.trim() : "",
    safetyIconTableId: typeof env.FEISHU_SAFETY_ICON_TABLE_ID === "string" ? env.FEISHU_SAFETY_ICON_TABLE_ID.trim() : "",
    sopTableId: typeof env.FEISHU_SOP_TABLE_ID === "string" ? env.FEISHU_SOP_TABLE_ID.trim() : "",
    partUsedTableId: typeof env.FEISHU_PART_USED_TABLE_ID === "string" ? env.FEISHU_PART_USED_TABLE_ID.trim() : "",
    partUsedInventoryCountTableId: typeof env.FEISHU_PART_USED_INVENTORY_COUNT_TABLE_ID === "string" ? env.FEISHU_PART_USED_INVENTORY_COUNT_TABLE_ID.trim() : "",
    projectTableId: typeof env.FEISHU_PROJECT_TABLE_ID === "string" ? env.FEISHU_PROJECT_TABLE_ID.trim() : "",
    caseCategoryTableId: typeof env.FEISHU_CASE_CATEGORY_TABLE_ID === "string" ? env.FEISHU_CASE_CATEGORY_TABLE_ID.trim() : "",
    caseClassTableId: typeof env.FEISHU_CASE_CLASS_TABLE_ID === "string" ? env.FEISHU_CASE_CLASS_TABLE_ID.trim() : "",
    operationNewsTableId: typeof env.FEISHU_OPERATION_NEWS_TABLE_ID === "string" ? env.FEISHU_OPERATION_NEWS_TABLE_ID.trim() : "",
    warehouseTimeZone: typeof env.WAREHOUSE_TIME_ZONE === "string" && env.WAREHOUSE_TIME_ZONE.trim() ? env.WAREHOUSE_TIME_ZONE.trim() : "America/Toronto"
  };
}

export function isFeishuConfigured(env) {
  return REQUIRED_KEYS.every((key) => Boolean(env && typeof env[key] === "string" && env[key].trim()));
}
