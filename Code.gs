/****************************************************************
 * 통합 관리 시스템 v2.9 - 서버 스크립트 (Code.gs)
 * @description
 * - getDeliveryHistory 함수가 시트 헤더를 올바른 행(2행)에서 읽도록 수정.
 * - 데이터 조회 정확성 향상.
 ****************************************************************/

// CONFIG 및 다른 함수들은 이전과 동일하게 유지됩니다.
const MASTER_SSID = '1b3Bn0JFjhhlcs0SPPkNFH7SdhMNjO_-zKOxSysn9EVI';

const CONFIG = {
  SSID: MASTER_SSID,
  SHEETS: {
    DB_MASTER: '기본정보',
    ORDER_STATUS: '발주현황',
    INVENTORY: '재고조회',
    PRODUCTION_PLAN: '생산계획',
    SHIPPING_REQUEST: '출고요청',
    SHIPPING_HISTORY: '출고비교'
  }
};

const SheetService = {
  _cache: {},
  _getSpreadsheet: function(ssid) {
    if (!this._cache[ssid]) this._cache[ssid] = SpreadsheetApp.openById(ssid);
    return this._cache[ssid];
  },
  _getSheet: function(ssid, sheetName) {
    const ss = this._getSpreadsheet(ssid);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error(`시트 '${sheetName}'을(를) 찾을 수 없습니다.`);
    return sheet;
  },
  getDataAsObjects: function({ ssid, sheetName, headerRow = 1, dataStartRow = 2 }) {
    const sheet = this._getSheet(ssid, sheetName);
    const lastRow = sheet.getLastRow();
    if (lastRow < dataStartRow) return [];
    const headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const dataRange = sheet.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, headers.length);
    const values = dataRange.getValues();
    return values.map(row => headers.reduce((obj, header, index) => {
      if(header) obj[header] = row[index];
      return obj;
    }, {}));
  }
};

// ... doGet, getPageContent, include 함수 (변경 없음) ...
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('main');
  template.initialApp = e.parameter.app || 'orderMgmt';
  template.initialPage = e.parameter.page || 'index';
  return template.evaluate().setTitle('통합 재고관리 시스템')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

function getPageContent(pageFileName) {
  const allowedPages = ['index', 'poStatus', 'stockReceiving', 'inventoryLookup', 'productionPlan', 'shippingRequest', 'shippingConfirmation', 'deliveryHistory', 'shippingSummary'];
  if (!pageFileName || !allowedPages.includes(pageFileName)) {
    return HtmlService.createHtmlOutputFromFile('index').getContent();
  }
  return HtmlService.createHtmlOutputFromFile(pageFileName).getContent();
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ... getShippingSummary, _parseShippingDate, getOrderStatusDashboardData, getPoStatusDetails 등 (변경 없음) ...
function getShippingSummary(month) {
  try {
    const sheet = SheetService._getSheet(CONFIG.SSID, CONFIG.SHEETS.SHIPPING_HISTORY);
    const allData = sheet.getDataRange().getDisplayValues();
    const headers = allData[1]; 
    const dataRows = allData.slice(2); 
    
    const dateCol = headers.indexOf('출하일자'), typeCol = headers.indexOf('종류'), codeCol = headers.indexOf('품목코드'), nameCol = headers.indexOf('품명'), qtyCol = headers.indexOf('수량');
    if ([dateCol, typeCol, codeCol, nameCol, qtyCol].includes(-1)) throw new Error("필수 헤더('출하일자', '종류' 등)를 '출고비교' 시트에서 찾을 수 없습니다.");
    
    const results = {};
    const isTotalView = (month === 'all');
    const targetMonthNumber = parseInt(month, 10);
    
    dataRows.forEach(row => {
      const parsedDate = _parseShippingDate(row[dateCol]);
      if (parsedDate && (isTotalView || parsedDate.month === targetMonthNumber)) {
        const { year } = parsedDate;
        const [type, code, name, quantityStr] = [row[typeCol], row[codeCol], row[nameCol], row[qtyCol]];
        const quantity = parseInt(String(quantityStr).replace(/,/g, ''), 10);
        if (!type || !code || !name || isNaN(quantity)) return;
        if (!results[type]) results[type] = { items: {}, subtotals: {} };
        if (!results[type].items[code]) results[type].items[code] = { itemName: name, quantitiesByYear: {} };
        results[type].items[code].quantitiesByYear[year] = (results[type].items[code].quantitiesByYear[year] || 0) + quantity;
        results[type].subtotals[year] = (results[type].subtotals[year] || 0) + quantity;
      }
    });
    return results;
  } catch (e) { return { error: e.message }; }
}

function _parseShippingDate(dateString) {
  if (!dateString || typeof dateString !== 'string') return null;
  const match = dateString.match(/(\d{2,4})[^\d\w]*(\d{1,2})/);
  if (match) {
    let year = match[1];
    if (year.length === 4) year = year.substring(2);
    return { year, month: parseInt(match[2], 10) };
  }
  return null;
}

function getOrderStatusDashboardData(filters = {}) {
  try {
    const dbData = SheetService.getDataAsObjects({ ssid: CONFIG.SSID, sheetName: CONFIG.SHEETS.DB_MASTER, headerRow: 2, dataStartRow: 3 });
    const itemMaster = new Map();
    const categorySet = new Set();
    const businessUnitSet = new Set();
    dbData.forEach(row => {
      const code = String(row['유한 품번'] || '').trim();
      if (code) {
        const category = String(row['분류'] || '미분류').trim();
        const businessUnit = String(row['사업부'] || '미분류').trim();
        itemMaster.set(code, { itemName: String(row['품명']).trim(), gskemPN: String(row['지에스켐 품번']).trim(), category: category, businessUnit: businessUnit });
        if (category) categorySet.add(category);
        if (businessUnit) businessUnitSet.add(businessUnit);
      }
    });
    
    const orderData = SheetService.getDataAsObjects({ ssid: CONFIG.SSID, sheetName: CONFIG.SHEETS.ORDER_STATUS, headerRow: 1, dataStartRow: 2 });
    const orders = new Map();
    orderData.forEach(row => {
      const code = String(row['유한품번'] || '').trim();
      if (!code) return;
      const date = parseDateString(row['발주일']);
      const qty = Number(row['수량']);
      if (date && !isNaN(qty) && qty > 0) {
        if (!orders.has(code)) orders.set(code, { total: 0, transactions: [] });
        const orderInfo = orders.get(code);
        orderInfo.total += qty;
        orderInfo.transactions.push({ date, qty });
      }
    });
    
    const historyData = SheetService.getDataAsObjects({ ssid: CONFIG.SSID, sheetName: CONFIG.SHEETS.SHIPPING_HISTORY, headerRow: 2, dataStartRow: 3 });
    const deliveries = new Map();
    historyData.forEach(row => {
        const code = String(row['품목코드'] || '').trim();
        const qty = Number(row['수량']);
        if (code && !isNaN(qty)) deliveries.set(code, (deliveries.get(code) || 0) + qty);
    });
    
    let results = [];
    for (const [code, orderInfo] of orders.entries()) {
      const master = itemMaster.get(code) || {};
      const balance = orderInfo.total - (deliveries.get(code) || 0);
      if (balance <= 0) continue;
      if (filters.yuhanPartNo && !code.includes(filters.yuhanPartNo)) continue;
      if (filters.category && master.category !== filters.category) continue;
      if (filters.businessUnit && master.businessUnit !== filters.businessUnit) continue;
      
      results.push({
        itemCode: code, gskemPN: master.gskemPN || '', itemName: master.itemName || '품명 정보 없음', balance: balance,
        transactions: orderInfo.transactions.map(t => ({
          date: Utilities.formatDate(t.date, Session.getScriptTimeZone(), 'yyyy-MM-dd'), qty: t.qty
        })).sort((a,b) => new Date(b.date) - new Date(a.date))
      });
    }

    const businessUnitsArray = Array.from(businessUnitSet);
    const customBuOrder = ['생활유통', 'OTC'];
    businessUnitsArray.sort((a, b) => {
        const indexA = customBuOrder.indexOf(a);
        const indexB = customBuOrder.indexOf(b);
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return a.localeCompare(b);
    });

    return {
      results: results.sort((a,b) => a.itemName.localeCompare(b.itemName)),
      categories: Array.from(categorySet).sort(),
      businessUnits: businessUnitsArray
    };
  } catch (e) {
    Logger.log(`getOrderStatusDashboardData Error: ${e.stack}`);
    return { error: e.message, results: [], categories: [], businessUnits: [] };
  }
}

function getPoStatusDetails(filters = {}) {
  try {
    const dbData = SheetService.getDataAsObjects({ ssid: CONFIG.SSID, sheetName: CONFIG.SHEETS.DB_MASTER, headerRow: 2, dataStartRow: 3 });
    const itemMaster = new Map();
    const categorySet = new Set();
    const businessUnitSet = new Set();
    dbData.forEach(row => {
      const code = String(row['유한 품번'] || '').trim();
      if (code) {
        const category = String(row['분류'] || '미분류').trim();
        const businessUnit = String(row['사업부'] || '미분류').trim();
        itemMaster.set(code, {
          itemName: String(row['품명']).trim(), gskemPN: String(row['지에스켐 품번']).trim(),
          category: category, businessUnit: businessUnit
        });
        if (category) categorySet.add(category);
        if (businessUnit) businessUnitSet.add(businessUnit);
      }
    });

    const orderData = SheetService.getDataAsObjects({ ssid: CONFIG.SSID, sheetName: CONFIG.SHEETS.ORDER_STATUS, headerRow: 1, dataStartRow: 2 });
    const orders = new Map();
    orderData.forEach(row => {
      const code = String(row['유한품번'] || '').trim();
      if (!code) return;
      const date = parseDateString(row['발주일']);
      const qty = Number(row['수량']);
      if (date && !isNaN(qty) && qty > 0) {
        if (!orders.has(code)) orders.set(code, { total: 0, transactions: [] });
        const orderInfo = orders.get(code);
        orderInfo.total += qty;
        orderInfo.transactions.push({ date, qty });
      }
    });

    const historyData = SheetService.getDataAsObjects({ ssid: CONFIG.SSID, sheetName: CONFIG.SHEETS.SHIPPING_HISTORY, headerRow: 2, dataStartRow: 3 });
    const deliveries = new Map();
    historyData.forEach(row => {
        const code = String(row['품목코드'] || '').trim();
        const qty = Number(row['수량']);
        if (code && !isNaN(qty)) deliveries.set(code, (deliveries.get(code) || 0) + qty);
    });

    let results = [];
    for (const [code, orderInfo] of orders.entries()) {
      const master = itemMaster.get(code) || {};
      const cumulativeDelivered = deliveries.get(code) || 0;
      const balance = orderInfo.total - cumulativeDelivered;
      
      if (balance <= 0) continue;
      if (filters.yuhanPartNo && !code.includes(filters.yuhanPartNo)) continue;
      if (filters.category && master.category !== filters.category) continue;
      if (filters.businessUnit && master.businessUnit !== filters.businessUnit) continue;
      
      results.push({
        itemCode: code, gskemPN: master.gskemPN || '', itemName: master.itemName || '품명 정보 없음',
        totalOrdered: orderInfo.total, cumulativeDelivered: cumulativeDelivered, balance: balance,
        transactions: orderInfo.transactions.map(t => ({
          date: Utilities.formatDate(t.date, Session.getScriptTimeZone(), 'yyyy-MM-dd'), qty: t.qty
        })).sort((a,b) => new Date(b.date) - new Date(a.date))
      });
    }
    
    const businessUnitsArray = Array.from(businessUnitSet);
    const customBuOrder = ['생활유통', 'OTC'];
    businessUnitsArray.sort((a, b) => {
        const indexA = customBuOrder.indexOf(a);
        const indexB = customBuOrder.indexOf(b);
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return a.localeCompare(b);
    });

    return {
      results: results.sort((a,b) => a.itemName.localeCompare(b.itemName)),
      categories: Array.from(categorySet).sort(),
      businessUnits: businessUnitsArray
    };
  } catch (e) {
    Logger.log(`getPoStatusDetails Error: ${e.stack}`);
    return { error: e.message, results: [], categories: [], businessUnits: [] };
  }
}

function getYuhanProductInfo(yuhanPartNo) {
  if (!yuhanPartNo) return null;
  try {
    const dbData = SheetService.getDataAsObjects({ ssid: CONFIG.SSID, sheetName: CONFIG.SHEETS.DB_MASTER, headerRow: 2, dataStartRow: 3 });
    const product = dbData.find(row => String(row['유한 품번']).trim().toLowerCase() === yuhanPartNo.trim().toLowerCase());
    if (!product) return null;
    return {
      '유한 품번': String(product['유한 품번']).trim(), '지에스켐품번': String(product['지에스켐 품번'] || '').trim(),
      '품명': String(product['품명'] || '').trim(), '사업부': String(product['사업부'] || '').trim()
    };
  } catch (e) { Logger.log(`getYuhanProductInfo Error: ${e.stack}`); return { error: e.message }; }
}

function getProductInfoByGSKEM(gskemPartNo) {
  if (!gskemPartNo || !gskemPartNo.trim()) return null;
  try {
    const dbData = SheetService.getDataAsObjects({ ssid: CONFIG.SSID, sheetName: CONFIG.SHEETS.DB_MASTER, headerRow: 2, dataStartRow: 3 });
    const product = dbData.find(row => String(row['지에스켐 품번']).trim().toLowerCase() === gskemPartNo.trim().toLowerCase());
    if (!product) return null;
    return {
      '유한 품번': String(product['유한 품번'] || '').trim(), '품명': String(product['품명'] || '').trim(),
      '입수량': Number(product['입수량']) || null, '1PLT': Number(product['1PLT']) || null, '비고': String(product['비고'] || '').trim()
    };
  } catch (e) { Logger.log(`getProductInfoByGSKEM Error: ${e.stack}`); return { error: e.message }; }
}

function getInventoryDetails() {
  try {
    const dbData = SheetService.getDataAsObjects({ ssid: CONFIG.SSID, sheetName: CONFIG.SHEETS.DB_MASTER, headerRow: 2, dataStartRow: 3 });
    const itemClassificationMap = dbData.reduce((map, row) => {
      const itemCodeVal = String(row['유한 품번']).trim();
      if (itemCodeVal) map[itemCodeVal] = String(row['분류']).trim() || '미분류';
      return map;
    }, {});
    
    const invData = SheetService.getDataAsObjects({ ssid: CONFIG.SSID, sheetName: CONFIG.SHEETS.INVENTORY, headerRow: 1, dataStartRow: 2 });
    const aggregatedInventory = {};
    invData.forEach((row, index) => {
      const itemCode = String(row["품목코드"] || "").trim();
      if (!itemCode) return;
      const key = `${itemCode}||${row["제품명"]}`;
      if (!aggregatedInventory[key]) {
        aggregatedInventory[key] = {
          itemCode, itemName: String(row["제품명"] || ""), classification: itemClassificationMap[itemCode] || '미분류',
          remarks: String(row["비고"] || ""), totalQuantity: 0, lots: []
        };
      }
      const quantity = parseFloat(row["수량"] || 0);
      if (isNaN(quantity)) return;
      aggregatedInventory[key].totalQuantity += quantity;
      aggregatedInventory[key].lots.push({
        lot: String(row["LOT"] || ""), quantity: quantity,
        mfgDate: row["제조일자"] ? Utilities.formatDate(parseDateString(row["제조일자"]), Session.getScriptTimeZone(), "yyyy-MM-dd") : '',
        expDate: row["유통기한"] ? Utilities.formatDate(parseDateString(row["유통기한"]), Session.getScriptTimeZone(), "yyyy-MM-dd") : '',
        packSize: String(row["입수"] || ""), boxQty: String(row["BOX수량"] || ""),
        palletQty: String(row["파레트수량"] || ""), remarks: String(row["비고"] || ""),
        originalSheetRowIndex: index + 2
      });
    });
    
    const finalList = Object.values(aggregatedInventory);
    finalList.sort((a, b) => a.classification.localeCompare(b.classification) || a.itemCode.localeCompare(b.itemCode));
    return finalList;
  } catch (e) { Logger.log("Error in getInventoryDetails: " + e.stack); return []; }
}

function getInventoryDetailsByYuhanCode(yuhanPartNo) {
  if (!yuhanPartNo) throw new Error("조회할 품목코드를 입력해주세요.");
  try {
    const dbData = SheetService.getDataAsObjects({ ssid: CONFIG.SSID, sheetName: CONFIG.SHEETS.DB_MASTER, headerRow: 2, dataStartRow: 3 });
    const product = dbData.find(row => String(row['유한 품번']).trim() === yuhanPartNo.trim());
    if (!product) throw new Error("기본정보에 해당 품목코드가 없습니다.");
    
    const staticInfo = { itemName: product['품명'], packSize: product['입수량'], itemsPerPallet: product['1PLT'] };
    
    const invData = SheetService.getDataAsObjects({ ssid: CONFIG.SSID, sheetName: CONFIG.SHEETS.INVENTORY, headerRow: 1, dataStartRow: 2 });
    const lots = invData
      .filter(row => String(row['품목코드']).trim() === yuhanPartNo.trim() && Number(row['수량']) > 0)
      .map(row => ({
        lotNumber: row['LOT'], quantity: row['수량'],
        mfgDate: row['제조일자'] ? Utilities.formatDate(parseDateString(row['제조일자']), Session.getScriptTimeZone(), "yyyy-MM-dd") : '',
        expDate: row['유통기한'] ? Utilities.formatDate(parseDateString(row['유통기한']), Session.getScriptTimeZone(), "yyyy-MM-dd") : ''
      }));
      
    return { staticInfo, lots };
  } catch (e) { Logger.log(`getInventoryDetailsByYuhanCode Error: ${e.stack}`); return { error: e.message }; }
}

function saveReceivedStock(receivedItems) {
  try {
    const sheet = SheetService._getSheet(CONFIG.SSID, CONFIG.SHEETS.INVENTORY);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const rowsToAppend = receivedItems.map(item => {
        const rowObject = {
            "품목코드": item.itemCode || '', "제품명": item.itemName || '', "입수": item.packSize || '',
            "BOX수량": item.boxQty || '', "수량": item.quantity || 0, "LOT": item.lot || '',
            "제조일자": item.mfgDate ? parseDateString(item.mfgDate) : '', "유통기한": item.expDate ? parseDateString(item.expDate) : '',
            "파렛트수량": item.palletQty || '', "비고": item.remarks || ''
        };
        return headers.map(header => rowObject[header] !== undefined ? rowObject[header] : '');
    });
    
    if (rowsToAppend.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, headers.length).setValues(rowsToAppend);
      return { success: true, message: `${rowsToAppend.length}건의 입고 내역이 성공적으로 저장되었습니다.` };
    }
    return { success: false, message: '저장할 입고 품목이 없습니다.' };
  } catch (e) { Logger.log("Error in saveReceivedStock: " + e.stack); return { success: false, message: '입고 내역 저장 중 오류 발생: ' + e.message }; }
}

function updateInventoryLotDetail(updateData) {
  try {
    const { sheetRowIndex, newData } = updateData;
    if (!sheetRowIndex || isNaN(sheetRowIndex) || sheetRowIndex < 2) return { success: false, message: '유효하지 않은 시트 행 번호입니다: ' + sheetRowIndex };
    
    const sheet = SheetService._getSheet(CONFIG.SSID, CONFIG.SHEETS.INVENTORY);
    if (sheetRowIndex > sheet.getLastRow()) return { success: false, message: `수정할 행(${sheetRowIndex})이 시트 범위를 벗어났습니다.` };
    
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const fieldsToUpdate = {
      "LOT": newData.lot, "수량": newData.quantity, "제조일자": newData.mfgDate ? parseDateString(newData.mfgDate) : null,
      "유통기한": newData.expDate ? parseDateString(newData.expDate) : null, "파렛트수량": newData.palletQty, "비고": newData.remarks
    };
    
    let updated = false;
    headers.forEach((header, index) => {
      if (fieldsToUpdate.hasOwnProperty(header)) {
        let valueToSet = fieldsToUpdate[header];
        sheet.getRange(sheetRowIndex, index + 1).setValue(valueToSet === '' ? null : valueToSet);
        updated = true;
      }
    });
    
    if (updated) return { success: true, message: `재고 정보(시트 ${sheetRowIndex}행)가 성공적으로 수정되었습니다.` };
    return { success: false, message: `수정할 필드를 찾지 못했거나 데이터가 없습니다.` };
  } catch (e) { Logger.log(`Error in updateInventoryLotDetail: ${e.stack}`); return { success: false, message: `재고 정보 수정 중 오류 발생: ${e.message}` }; }
}

function deleteInventoryLotItem(sheetRowIndex) {
  try {
    if (!sheetRowIndex || isNaN(sheetRowIndex) || sheetRowIndex < 2) return { success: false, message: '유효하지 않은 시트 행 번호입니다: ' + sheetRowIndex };
    const sheet = SheetService._getSheet(CONFIG.SSID, CONFIG.SHEETS.INVENTORY);
    if (sheetRowIndex > sheet.getLastRow()) return { success: false, message: `삭제할 행(${sheetRowIndex})이 시트 범위를 벗어났습니다.` };
    sheet.deleteRow(sheetRowIndex);
    return { success: true, message: `재고(시트 ${sheetRowIndex}행)가 성공적으로 삭제되었습니다.` };
  } catch (e) { Logger.log(`Error in deleteInventoryLotItem: ${e.stack}`); return { success: false, message: `재고 삭제 중 오류 발생: ${e.message}` }; }
}

function submitOrderToSheet(orders) {
  try {
    const sheet = SheetService._getSheet(CONFIG.SSID, CONFIG.SHEETS.ORDER_STATUS);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const requiredHeaders = ['발주일', '유한품번', '지에스켐 품번', '품명', '수량', '납기일', '사업부'];
    for (const rh of requiredHeaders) {
        if (!headers.includes(rh)) return { success: false, message: `'${CONFIG.SHEETS.ORDER_STATUS}' 시트에 필수 헤더 '${rh}'가 없습니다.` };
    }
    
    const valuesToAppend = orders.map(order => {
        const rowObject = {
            '발주일': parseDateString(order.issueDate), '사업부': order.businessUnit, '유한품번': order.yuhanPartNo,
            '지에스켐 품번': order.gskemPartNo, '품명': order.itemName, '수량': Number(order.quantity), '납기일': parseDateString(order.deliveryDate)
        };
        return headers.map(header => rowObject[header] || '');
    });
    
    if (valuesToAppend.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, valuesToAppend.length, headers.length).setValues(valuesToAppend);
      return { success: true, message: '발주서가 성공적으로 기록되었습니다.' };
    }
    return { success: false, message: '제출할 유효한 발주 품목이 없습니다.' };
  } catch (e) { Logger.log(`submitOrderToSheet Error: ${e.stack}`); return { success: false, message: '데이터 기록 중 오류: ' + e.message }; }
}

function deleteOrderRow(rowIdx) {
  if (!rowIdx || isNaN(rowIdx) || rowIdx < 2) return { success: false, message: '유효하지 않은 행 번호입니다.' };
  try {
    const sheet = SheetService._getSheet(CONFIG.SSID, CONFIG.SHEETS.ORDER_STATUS);
    if (rowIdx > sheet.getLastRow()) return { success: false, message: '삭제할 행이 시트 범위를 벗어났습니다.' };
    sheet.deleteRow(rowIdx);
    return { success: true, message: `발주 내역 ${rowIdx}행이 성공적으로 삭제되었습니다.` };
  } catch (e) { Logger.log(`deleteOrderRow Error: ${e.stack}`); return { success: false, message: `행 삭제 중 오류 발생: ${e.message}` }; }
}

function saveProductionPlanItems(planDataArray) {
  try {
    const ss = SheetService._getSpreadsheet(CONFIG.SSID);
    const sheetName = CONFIG.SHEETS.PRODUCTION_PLAN;
    let sheet = ss.getSheetByName(sheetName);
    const headers = ["생산일", "지에스켐 품번", "유한품번", "품명", "수량"];
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(headers);
      sheet.getRange("A1:E1").setFontWeight("bold");
    }
    
    if (!planDataArray || planDataArray.length === 0) return { success: false, message: "저장할 품목 정보가 없습니다." };
    
    const rowsToAppend = planDataArray.map(item => {
      if (!item.productionDate || !item.quantity) throw new Error("각 품목에는 생산일과 수량이 반드시 포함되어야 합니다.");
      return [parseDateString(item.productionDate), item.gskemPartNo || "", item.yuhanPartNo || "", item.itemName || "", item.quantity];
    });
    
    if (rowsToAppend.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, headers.length).setValues(rowsToAppend);
      return { success: true, message: rowsToAppend.length + "개 품목의 생산 계획이 성공적으로 저장되었습니다." };
    }
    return { success: false, message: "저장할 유효한 품목 데이터가 없습니다." };
  } catch (e) { Logger.log(`saveProductionPlanItems Error: ${e.stack}`); return { success: false, message: "생산 계획 저장 중 오류 발생: " + e.message }; }
}

function getProductionPlansForCalendar(year, month) {
  try {
    const data = SheetService.getDataAsObjects({ssid: CONFIG.SSID, sheetName: CONFIG.SHEETS.PRODUCTION_PLAN, headerRow: 1, dataStartRow: 2});
    const targetMonth = parseInt(month, 10) - 1;
    const targetYear = parseInt(year, 10);
    
    return data.map((row, index) => {
      let productionDateObj = parseDateString(row["생산일"]);
      if (productionDateObj && productionDateObj.getFullYear() === targetYear && productionDateObj.getMonth() === targetMonth) {
        return {
          originalSheetRowIndex: index + 2, date: Utilities.formatDate(productionDateObj, Session.getScriptTimeZone(), "yyyy-MM-dd"),
          gskemPartNo: String(row["지에스켐 품번"] || ""), yuhanPartNo: String(row["유한품번"] || ""),
          itemName: String(row["품명"] || ""), quantity: String(row["수량"] || "")
        };
      }
      return null;
    }).filter(Boolean);
  } catch (e) { Logger.log("getProductionPlansForCalendar Error: " + e.stack); return []; }
}

function deleteProductionPlan(sheetRowIndex) {
  try {
    if (!sheetRowIndex || isNaN(sheetRowIndex) || sheetRowIndex < 2) return { success: false, message: '유효하지 않은 행 번호입니다.' };
    const sheet = SheetService._getSheet(CONFIG.SSID, CONFIG.SHEETS.PRODUCTION_PLAN);
    if (sheetRowIndex > sheet.getLastRow()) return { success: false, message: `삭제할 행(${sheetRowIndex})이 시트 범위를 벗어났습니다.` };
    sheet.deleteRow(sheetRowIndex);
    return { success: true, message: `생산 계획 (시트 ${sheetRowIndex}행)이 성공적으로 삭제되었습니다.` };
  } catch (e) { Logger.log(`deleteProductionPlan Error: ${e.stack}`); return { success: false, message: `생산 계획 삭제 중 오류 발생: ${e.message}` }; }
}

function updateProductionPlanItem(updateInfo) {
  try {
    const { rowIndex, newData } = updateInfo;
    if (!rowIndex || isNaN(rowIndex) || rowIndex < 2) return { success: false, message: '유효하지 않은 행 번호입니다.' };
    if (!newData || typeof newData !== 'object') return { success: false, message: '수정할 데이터가 올바르지 않습니다.' };
    
    const sheet = SheetService._getSheet(CONFIG.SSID, CONFIG.SHEETS.PRODUCTION_PLAN);
    if (rowIndex > sheet.getLastRow()) return { success: false, message: `수정할 행(${rowIndex})이 시트 범위를 벗어났습니다.` };
    
    const valuesToUpdate = [
      parseDateString(newData.productionDate) || '', newData.gskemPartNo || '', newData.yuhanPartNo || '',
      newData.itemName || '', Number(newData.quantity) || 0
    ];
    sheet.getRange(rowIndex, 1, 1, valuesToUpdate.length).setValues([valuesToUpdate]);
    
    return { success: true, message: `생산 계획 (시트 ${rowIndex}행)이 성공적으로 수정되었습니다.` };
  } catch (e) { Logger.log(`updateProductionPlanItem Error: ${e.stack}`); return { success: false, message: `생산 계획 수정 중 오류 발생: ${e.message}` }; }
}

function submitShipmentRequest(items) {
  try {
    const ss = SheetService._getSpreadsheet(CONFIG.SSID);
    let sheet = ss.getSheetByName(CONFIG.SHEETS.SHIPPING_REQUEST);
    const headers = ['요청일', '품목코드', '품명', 'LOT', '수량', 'BOX수량', '파렛트수량', '상태', '입수', '제조일자', '유통기한'];
    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.SHEETS.SHIPPING_REQUEST);
      sheet.appendRow(headers);
    }
    
    const logs = items.map(item => [
      parseDateString(item.shippingDate), item.itemCode, item.itemName, item.lotNumber,
      item.quantity, item.boxQty, item.palletQty, '확인 대기',
      item.packSize, parseDateString(item.mfgDate), parseDateString(item.expDate)
    ]);
    
    if (logs.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, logs.length, logs[0].length).setValues(logs);
    return { success: true, message: `${items.length}건의 출고 요청이 등록되었습니다.` };
  } catch (e) { Logger.log(`submitShipmentRequest Error: ${e.stack}`); return { success: false, message: `요청 등록 중 오류 발생: ${e.message}` }; }
}

function getPendingShipments() {
  try {
    const sheet = SheetService._getSheet(CONFIG.SSID, CONFIG.SHEETS.SHIPPING_REQUEST);
    if (sheet.getLastRow() < 2) return [];
    
    const data = SheetService.getDataAsObjects({ssid: CONFIG.SSID, sheetName: CONFIG.SHEETS.SHIPPING_REQUEST, headerRow: 1, dataStartRow: 2});
    const pendingRequests = data.map((row, index) => {
      if (String(row['상태']) !== '확인 대기') return null;
      
      const formatDate = (dateValue) => {
          const dateObj = parseDateString(dateValue);
          return dateObj instanceof Date && !isNaN(dateObj) ? Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "yyyy-MM-dd") : '';
      };
      
      return {
        rowId: index + 2, shippingDate: formatDate(row['요청일']), itemCode: row['품목코드'],
        itemName: row['품명'], lotNumber: row['LOT'], quantity: row['수량'], boxQty: row['BOX수량'],
        palletQty: row['파렛트수량'], packSize: row['입수'], mfgDate: formatDate(row['제조일자']),
        expDate: formatDate(row['유통기한'])
      };
    }).filter(Boolean);
    
    pendingRequests.sort((a, b) => new Date(b.shippingDate) - new Date(a.shippingDate));
    return pendingRequests;
  } catch(e) { Logger.log(`getPendingShipments Error: ${e.stack}`); return { error: e.message }; }
}

function updateShipmentRequest(requestData) {
  try {
    const { rowId, itemCode, newDate, newQuantity } = requestData;
    const dbData = SheetService.getDataAsObjects({ ssid: CONFIG.SSID, sheetName: CONFIG.SHEETS.DB_MASTER, headerRow: 2, dataStartRow: 3 });
    const product = dbData.find(row => String(row['유한 품번']).trim() === itemCode);
    const packSize = product ? Number(product['입수량']) : 0;
    const itemsPerPallet = product ? Number(product['1PLT']) : 0;
    
    if (packSize > 0 && newQuantity % packSize !== 0) {
      return { success: false, message: `수량은 BOX 단위(${packSize}개)로 입력해야 합니다.` };
    }
    
    const shippingSheet = SheetService._getSheet(CONFIG.SSID, CONFIG.SHEETS.SHIPPING_REQUEST);
    const headers = shippingSheet.getRange(1, 1, 1, shippingSheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const colMap = { date: headers.indexOf('요청일') + 1, qty: headers.indexOf('수량') + 1, box: headers.indexOf('BOX수량') + 1, pallet: headers.indexOf('파렛트수량') + 1 };
    
    if(colMap.date > 0) shippingSheet.getRange(rowId, colMap.date).setValue(parseDateString(newDate));
    if(colMap.qty > 0) shippingSheet.getRange(rowId, colMap.qty).setValue(newQuantity);
    if (colMap.box > 0) shippingSheet.getRange(rowId, colMap.box).setValue(packSize > 0 ? newQuantity / packSize : 0);
    if (colMap.pallet > 0) shippingSheet.getRange(rowId, colMap.pallet).setValue(itemsPerPallet > 0 ? (newQuantity / itemsPerPallet) : 0);
    
    return { success: true, message: "요청이 수정되었습니다." };
  } catch(e) { Logger.log(`updateShipmentRequest Error: ${e.stack}`); return { success: false, message: `요청 수정 중 오류: ${e.message}` }; }
}

function deleteShipmentRequest(rowId) {
  try {
    const sheet = SheetService._getSheet(CONFIG.SSID, CONFIG.SHEETS.SHIPPING_REQUEST);
    sheet.deleteRow(rowId);
    return { success: true, message: "요청이 삭제되었습니다." };
  } catch (e) { Logger.log(`deleteShipmentRequest Error: ${e.stack}`); return { success: false, message: e.message }; }
}

function confirmShipment(rowId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SheetService._getSpreadsheet(CONFIG.SSID);
    const shippingSheet = ss.getSheetByName(CONFIG.SHEETS.SHIPPING_REQUEST);
    const invSheet = ss.getSheetByName(CONFIG.SHEETS.INVENTORY);
    const historySheet = ss.getSheetByName(CONFIG.SHEETS.SHIPPING_HISTORY);
    
    const reqHeaders = shippingSheet.getRange(1, 1, 1, shippingSheet.getLastColumn()).getValues()[0];
    const reqHeaderMap = new Map(reqHeaders.map((h, i) => [h, i]));
    const reqRow = shippingSheet.getRange(rowId, 1, 1, reqHeaders.length).getValues()[0];
    
    const reqStatus = String(reqRow[reqHeaderMap.get('상태')]);
    if (reqStatus !== '확인 대기') return { success: false, message: '이미 처리되었거나 취소된 요청입니다.' };
    
    const reqCode = reqRow[reqHeaderMap.get('품목코드')];
    const reqLot = reqRow[reqHeaderMap.get('LOT')];
    const reqQty = Number(reqRow[reqHeaderMap.get('수량')]);
    
    const invValues = invSheet.getDataRange().getValues();
    const invHeaders = invValues.shift();
    const invHeaderMap = new Map(invHeaders.map((h, i) => [h, i]));
    
    let targetRowIndex = invValues.findIndex(invRow =>
        String(invRow[invHeaderMap.get('품목코드')]) === reqCode && String(invRow[invHeaderMap.get('LOT')]) === reqLot
    );
    if (targetRowIndex === -1) throw new Error(`재고 없음: 출고하려는 품목(LOT: ${reqLot})을 재고에서 찾을 수 없습니다.`);
    
    const currentQty = Number(invValues[targetRowIndex][invHeaderMap.get('수량')]);
    if (reqQty > currentQty) throw new Error(`재고 부족: 요청수량(${reqQty})이 현재고(${currentQty})보다 많습니다.`);
    
    const newQty = currentQty - reqQty;
    const actualSheetRow = targetRowIndex + 2;
    if (newQty <= 0) invSheet.deleteRow(actualSheetRow);
    else invSheet.getRange(actualSheetRow, invHeaderMap.get('수량') + 1).setValue(newQty);
    
    const historyHeaders = historySheet.getRange(1, 1, 1, historySheet.getLastColumn()).getValues()[0];
    const historyLogObject = {
        '납품일자': new Date(), '품목코드': reqCode, '품명': reqRow[reqHeaderMap.get('품명')], '수량': reqQty,
        'LOT': reqLot, '제조일자': reqRow[reqHeaderMap.get('제조일자')], '유효일자': reqRow[reqHeaderMap.get('유통기한')]
    };
    const historyLog = historyHeaders.map(header => historyLogObject[header] !== undefined ? historyLogObject[header] : '');
    historySheet.appendRow(historyLog);
    
    shippingSheet.getRange(rowId, reqHeaderMap.get('상태') + 1).setValue('출고 완료');
    return { success: true, message: `출고 처리 완료! (품목: ${reqCode}, 수량: ${reqQty})` };
  } catch (e) { Logger.log(`confirmShipment Error: ${e.stack}`); return { success: false, message: e.message };
  } finally { lock.releaseLock(); }
}


function getAvailableHistoryYears() {
  try {
    const sheet = SheetService._getSheet(CONFIG.SSID, CONFIG.SHEETS.SHIPPING_HISTORY);
    if (sheet.getLastRow() < 2) return [new Date().getFullYear()];
    
    const dateColumnValues = sheet.getRange("A2:A" + sheet.getLastRow()).getDisplayValues();
    const years = new Set();
    
    dateColumnValues.forEach(row => {
      const dateString = row[0];
      if (dateString) {
        const parsedDate = parseDateString(dateString);
        if (parsedDate) {
          years.add(parsedDate.getFullYear());
        }
      }
    });

    const yearArray = Array.from(years);
    if (yearArray.length === 0) {
        return [new Date().getFullYear()];
    }
    
    return yearArray.sort((a, b) => b - a);
  } catch (e) { 
    Logger.log(`getAvailableHistoryYears Error: ${e.stack}`); 
    return [new Date().getFullYear()]; 
  }
}

/**
 * [수정] '납품 이력 조회' 함수
 * '출고비교' 시트의 헤더가 2행에 있는 것을 명시적으로 지정하여 데이터 조회 오류를 해결했습니다.
 */
function getDeliveryHistory(filters) {
  try {
    const data = SheetService.getDataAsObjects({ 
      ssid: CONFIG.SSID, 
      sheetName: CONFIG.SHEETS.SHIPPING_HISTORY, 
      headerRow: 2, // 헤더가 2행에 있음을 지정
      dataStartRow: 3 // 데이터가 3행부터 시작함을 지정
    });
    
    const filteredData = data.filter(row => {
      const rowDate = parseDateString(row['출하일자'] || row['납품일자']);
      if (!rowDate) return false;
      if (filters.year && rowDate.getFullYear() != filters.year) return false;
      if (filters.month && (rowDate.getMonth() + 1) != filters.month) return false;
      const rowCode = String(row['품목코드'] || "").trim();
      if (filters.itemCode && !rowCode.includes(filters.itemCode)) return false;
      return true;
    });

    const aggregationMap = {};
    const formatDate = (dateValue) => {
        const dateObj = parseDateString(dateValue);
        return dateObj ? Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "yyyy-MM-dd") : '';
    };

    filteredData.forEach(row => {
      const itemCode = String(row['품목코드']);
      if (!itemCode) return;
      if (!aggregationMap[itemCode]) {
        aggregationMap[itemCode] = {
          itemCode: itemCode, itemName: String(row['품명']), grandTotalQuantity: 0, transactions: []
        };
      }
      const quantity = Number(row['수량']) || 0;
      aggregationMap[itemCode].grandTotalQuantity += quantity;
      aggregationMap[itemCode].transactions.push({
        date: formatDate(row['출하일자'] || row['납품일자']),
        lot: String(row['LOT'] || ''),
        quantity: quantity,
        mfgDate: formatDate(row['제조일자']),
        expDate: formatDate(row['유통기한'] || row['유효일자'])
      });
    });
    return Object.values(aggregationMap);
  } catch (e) { 
    Logger.log(`getDeliveryHistory Error: ${e.stack}`); 
    return { error: e.message };
  }
}

function parseDateString(dateString) {
  if (!dateString) return null;
  if (dateString instanceof Date && !isNaN(dateString)) return new Date(Date.UTC(dateString.getFullYear(), dateString.getMonth(), dateString.getDate()));
  if (typeof dateString !== 'string') return null;
  
  dateString = dateString.trim();
  if (dateString === "") return null;
  
  let date;
  let parts;
  
  parts = dateString.match(/^(\d{4})[-\.\/](\d{1,2})[-\.\/](\d{1,2})$/);
  if (parts) { 
      date = new Date(Date.UTC(parseInt(parts[1], 10), parseInt(parts[2], 10) - 1, parseInt(parts[3], 10))); 
      if (!isNaN(date)) return date; 
  }
  
  parts = dateString.match(/^(\d{4})[-\.\/](\d{1,2})$/);
  if (parts) { 
      date = new Date(Date.UTC(parseInt(parts[1], 10), parseInt(parts[2], 10) - 1, 1)); 
      if (!isNaN(date)) return date; 
  }

  parts = dateString.match(/^(\d{1,2})[-\.\/](\d{1,2})[-\.\/](\d{4})$/);
  if (parts) { 
      date = new Date(Date.UTC(parseInt(parts[3], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10))); 
      if (!isNaN(date)) return date; 
  }

  parts = dateString.match(/^(\d{2})[-\.\/](\d{1,2})[-\.\/](\d{1,2})$/);
  if (parts) { 
      let year = parseInt(parts[1], 10); 
      year += (year > 50 ? 1900 : 2000); 
      date = new Date(Date.UTC(year, parseInt(parts[2], 10) - 1, parseInt(parts[3], 10))); 
      if (!isNaN(date)) return date; 
  }
  
  if (!isNaN(parseFloat(dateString)) && isFinite(dateString)) {
    const num = parseFloat(dateString);
    if (num > 25569) { 
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
        date = new Date(excelEpoch.getTime() + num * 24 * 60 * 60 * 1000);
        if (!isNaN(date)) return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    }
  }
  
  date = new Date(dateString);
  if (!isNaN(date)) return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  
  return null;
}
