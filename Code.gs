/****************************************************************
 * * 통합 관리 시스템 v2.0 - 서버 스크립트 (Code.gs)
 * * @description
 * - GNB/LNB 내비게이션을 갖춘 SPA(Single Page Application) 구조를 지원합니다.
 * - doGet()은 항상 메인 레이아웃 페이지(main.html)를 렌더링합니다.
 * - getPageContent() 함수가 클라이언트의 요청에 따라 각 페이지의 HTML 조각을 제공합니다.
 * ****************************************************************/


// --- [환경설정] 전역 상수 ---
const CONFIG = {
  // [App 1] 출고 관리 요약
  SHIPPING_SUMMARY: {
    SSID: '1v1XBTKxtBbhUC8lfAbGZwDGZCPSIPVML__2BNZKlBd0', // 출고 요약 데이터가 있는 스프레드시트 ID
    SHEET_NAME: '시트1',
    HEADER_ROW: 2,
    DATA_START_ROW: 3
  },
  // [App 2] 발주/재고 관리 시스템
  ORDER_MGMT: {
    SSID: '1b3Bn0JFjhhlcs0SPPkNFH7SdhMNjO_-zKOxSysn9EVI', // 발주/재고 데이터가 있는 스프레드시트 ID
    DB_SHEET: '기본정보',
    ORDER_SHEET: '발주현황',
    PRODUCTION_PLAN_SHEET: "생산계획",
    INVENTORY_SHEET: "재고조회",
    SHIPPING_REQUEST_SHEET: "출고요청",
    DELIVERY_HISTORY_SHEET: "납품이력(25년)"
  }
};


/****************************************************************
 * * [메인 컨트롤러] SPA 라우팅 및 공통 서비스
 * ****************************************************************/

/**
 * 웹 앱의 메인 진입점입니다. 항상 메인 레이아웃 페이지(main.html)를 반환합니다.
 * URL 파라미터를 템플릿으로 전달하여 초기 페이지를 로드하게 합니다.
 * @param {object} e - 이벤트 객체
 * @returns {HtmlOutput}
 */
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('main');
  // URL 파라미터를 main.html로 전달하여 초기 페이지 로딩에 사용
  template.initialApp = e.parameter.app || 'orderMgmt';
  template.initialPage = e.parameter.page || 'index';
  
  return template.evaluate()
    .setTitle('통합 재고관리 시스템')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}


/**
 * 요청된 페이지의 HTML 내용을 반환합니다. 클라이언트 측에서 페이지를 동적으로 로드하는 데 사용됩니다.
 * @param {string} pageFileName - 불러올 HTML 파일의 이름 (확장자 제외)
 * @returns {string} 해당 HTML 파일의 내용
 */
function getPageContent(pageFileName) {
  const allowedPages = [
    'index', 'shippingSummary', 'deliveryHistory', 'inventoryLookup', 
    'productionPlan', 'shippingConfirmation', 'shippingRequest', 'stockReceiving'
  ];
  
  if (!pageFileName || !allowedPages.includes(pageFileName)) {
    // 허용되지 않거나 없는 페이지 요청 시, 기본 페이지(index)의 내용을 반환
    return HtmlService.createHtmlOutputFromFile('index').getContent();
  }
  return HtmlService.createHtmlOutputFromFile(pageFileName).getContent();
}


/**
 * 다른 HTML 파일 내에서 CSS나 JS 파일을 포함시키기 위한 함수
 * @param {string} filename - 포함할 파일의 이름
 * @returns {string} 파일의 내용
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}


/****************************************************************
 * * [App 1] 출고 관리 요약 (Shipping Summary)
 * ****************************************************************/

function getShippingSummary(month) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SHIPPING_SUMMARY.SSID);
    const sheet = ss.getSheetByName(CONFIG.SHIPPING_SUMMARY.SHEET_NAME);
    if (!sheet) throw new Error(`시트 이름 '${CONFIG.SHIPPING_SUMMARY.SHEET_NAME}'을(를) 찾을 수 없습니다.`);

    const allData = sheet.getDataRange().getDisplayValues();
    const headers = allData[CONFIG.SHIPPING_SUMMARY.HEADER_ROW - 1];
    const dataRows = allData.slice(CONFIG.SHIPPING_SUMMARY.DATA_START_ROW - 1);

    const dateCol = headers.indexOf('출하일자');
    const typeCol = headers.indexOf('종류');
    const codeCol = headers.indexOf('품목코드');
    const nameCol = headers.indexOf('품명');
    const qtyCol = headers.indexOf('수량');

    if ([dateCol, typeCol, codeCol, nameCol, qtyCol].includes(-1)) throw new Error("필수 헤더('출하일자', '종류' 등)를 모두 찾을 수 없습니다.");

    const results = {};
    const isTotalView = (month === 'all');
    const targetMonthNumber = parseInt(month, 10);

    dataRows.forEach(row => {
      const parsedDate = _parseShippingDate(row[dateCol]);
      if (parsedDate && (isTotalView || parsedDate.month === targetMonthNumber)) {
        const year = parsedDate.year;
        const type = row[typeCol];
        const code = row[codeCol];
        const name = row[nameCol];
        const quantity = parseInt(String(row[qtyCol]).replace(/,/g, ''), 10);

        if (!type || !code || !name || isNaN(quantity)) return;
        if (!results[type]) results[type] = { items: {}, subtotals: {} };
        if (!results[type].items[code]) results[type].items[code] = { itemName: name, quantitiesByYear: {} };

        results[type].items[code].quantitiesByYear[year] = (results[type].items[code].quantitiesByYear[year] || 0) + quantity;
        results[type].subtotals[year] = (results[type].subtotals[year] || 0) + quantity;
      }
    });
    return results;
  } catch (e) {
    Logger.log(`getShippingSummary Error: ${e.message}`);
    return { error: e.message };
  }
}

function _parseShippingDate(dateString) {
  if (!dateString || typeof dateString !== 'string') return null;
  const match = dateString.match(/(\d{2,4})[^\d\w]*(\d{1,2})/);
  if (match) {
    let year = match[1];
    if (year.length === 4) year = year.substring(2);
    return { year: year, month: parseInt(match[2], 10) };
  }
  return null;
}

/****************************************************************
 * * [App 2] 발주/재고 관리 시스템
 * ****************************************************************/

// --- 품목 정보 (기본정보 시트) 관련 함수 ---
function getYuhanProductInfo(yuhanPartNo) {
  if (!yuhanPartNo) return null;
  const sheet = SpreadsheetApp.openById(CONFIG.ORDER_MGMT.SSID).getSheetByName(CONFIG.ORDER_MGMT.DB_SHEET);
  if (!sheet) throw new Error(`시트 '${CONFIG.ORDER_MGMT.DB_SHEET}'를 찾을 수 없습니다.`);
  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data = sheet.getRange(3, 1, sheet.getLastRow() - 2, headers.length).getValues();
  const yuhanIdx = headers.indexOf('유한 품번');
  const gskemIdx = headers.indexOf('지에스켐 품번');
  const nameIdx = headers.indexOf('품명');
  const buIdx = headers.indexOf('사업부');
  if ([yuhanIdx, gskemIdx, nameIdx, buIdx].includes(-1)) throw new Error(`'${CONFIG.ORDER_MGMT.DB_SHEET}' 시트의 2행 헤더에서 필수 항목을 찾을 수 없습니다.`);
  for (const row of data) {
    if (String(row[yuhanIdx]).trim().toLowerCase() === yuhanPartNo.trim().toLowerCase()) {
      return {
        '유한 품번': String(row[yuhanIdx]).trim(),
        '지에스켐품번': row[gskemIdx] ? String(row[gskemIdx]).trim() : '',
        '품명': row[nameIdx] ? String(row[nameIdx]).trim() : '',
        '사업부': row[buIdx] ? String(row[buIdx]).trim() : ''
      };
    }
  }
  return null;
}

function getProductInfoByGSKEM(gskemPartNo) {
  if (!gskemPartNo || gskemPartNo.trim() === "") return null;
  const sheet = SpreadsheetApp.openById(CONFIG.ORDER_MGMT.SSID).getSheetByName(CONFIG.ORDER_MGMT.DB_SHEET);
  if (!sheet) throw new Error(`'${CONFIG.ORDER_MGMT.DB_SHEET}' 시트를 찾을 수 없습니다.`);
  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const data = sheet.getRange(3, 1, sheet.getLastRow() - 2, headers.length).getValues();
  const gskemIdx = headers.indexOf('지에스켐 품번');
  if (gskemIdx === -1) throw new Error(`'${CONFIG.ORDER_MGMT.DB_SHEET}' 시트 헤더에서 '지에스켐 품번'을 찾을 수 없습니다.`);
  const yuhanIdx = headers.indexOf('유한 품번');
  const nameIdx = headers.indexOf('품명');
  const packSizeIdx = headers.indexOf('입수량');
  const palletIdx = headers.indexOf('1PLT');
  const remarksIdx = headers.indexOf('비고');
  for (const row of data) {
    if (String(row[gskemIdx]).trim().toLowerCase() === gskemPartNo.trim().toLowerCase()) {
      return {
        '유한 품번': yuhanIdx !== -1 && row[yuhanIdx] ? String(row[yuhanIdx]).trim() : '',
        '품명': nameIdx !== -1 && row[nameIdx] ? String(row[nameIdx]).trim() : '',
        '입수량': packSizeIdx !== -1 && row[packSizeIdx] ? Number(row[packSizeIdx]) : null,
        '1PLT': palletIdx !== -1 && row[palletIdx] ? Number(row[palletIdx]) : null,
        '비고': remarksIdx !== -1 && row[remarksIdx] ? String(row[remarksIdx]).trim() : ''
      };
    }
  }
  return null;
}

// --- 재고 (재고조회 시트) 관련 함수 ---
function getInventoryDetails() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ORDER_MGMT.SSID);
    const dbSheet = ss.getSheetByName(CONFIG.ORDER_MGMT.DB_SHEET);
    const inventorySheet = ss.getSheetByName(CONFIG.ORDER_MGMT.INVENTORY_SHEET);
    if (!inventorySheet) return [];
    const itemClassificationMap = {};
    if (dbSheet && dbSheet.getLastRow() > 2) {
      const dbHeaders = dbSheet.getRange(2, 1, 1, dbSheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
      const itemCodeColDb = dbHeaders.indexOf('유한 품번');
      const classificationColDb = dbHeaders.indexOf('분류');
      if (itemCodeColDb !== -1 && classificationColDb !== -1) {
        const dbData = dbSheet.getRange(3, 1, dbSheet.getLastRow() - 2, Math.max(itemCodeColDb + 1, classificationColDb + 1)).getValues();
        dbData.forEach(dbRow => {
          const itemCodeVal = String(dbRow[itemCodeColDb]).trim();
          if (itemCodeVal) itemClassificationMap[itemCodeVal] = String(dbRow[classificationColDb]).trim() || '미분류';
        });
      }
    }
    const invValues = inventorySheet.getDataRange().getValues();
    if (invValues.length < 2) return [];
    const invHeaders = invValues.shift().map(h => String(h).trim());
    const headerMap = new Map(invHeaders.map((h, i) => [h, i]));
    const requiredHeaders = ["품목코드", "제품명", "수량", "LOT"];
    for(const rh of requiredHeaders) { if(!headerMap.has(rh)) throw new Error(`'${CONFIG.ORDER_MGMT.INVENTORY_SHEET}' 시트에 필수 헤더(${rh})가 없습니다.`); }
    const aggregatedInventory = {};
    invValues.forEach((row, index) => {
      const itemCode = String(row[headerMap.get("품목코드")] || "").trim();
      if (!itemCode) return;
      const itemName = String(row[headerMap.get("제품명")] || "");
      const key = `${itemCode}||${itemName}`;
      if (!aggregatedInventory[key]) {
        aggregatedInventory[key] = {
          itemCode, itemName, classification: itemClassificationMap[itemCode] || '미분류',
          remarks: String(row[headerMap.get("비고")] || ""), totalQuantity: 0, lots: []
        };
      }
      const quantity = parseFloat(row[headerMap.get("수량")] || 0);
      if (isNaN(quantity)) return;
      aggregatedInventory[key].totalQuantity += quantity;
      const mfgDateRaw = row[headerMap.get("제조일자")];
      const expDateRaw = row[headerMap.get("유통기한")];
      aggregatedInventory[key].lots.push({
        lot: String(row[headerMap.get("LOT")] || ""), quantity: quantity,
        mfgDate: mfgDateRaw ? Utilities.formatDate(parseDateString(mfgDateRaw), Session.getScriptTimeZone(), "yyyy-MM-dd") : '',
        expDate: expDateRaw ? Utilities.formatDate(parseDateString(expDateRaw), Session.getScriptTimeZone(), "yyyy-MM-dd") : '',
        packSize: String(row[headerMap.get("입수")] || ""), boxQty: String(row[headerMap.get("BOX수량")] || ""),
        palletQty: String(row[headerMap.get("파레트수량")] || ""), remarks: String(row[headerMap.get("비고")] || ""),
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
  const ss = SpreadsheetApp.openById(CONFIG.ORDER_MGMT.SSID);
  const dbSheet = ss.getSheetByName(CONFIG.ORDER_MGMT.DB_SHEET);
  if (!dbSheet) throw new Error(`시트 '${CONFIG.ORDER_MGMT.DB_SHEET}'를 찾을 수 없습니다.`);
  const dbHeaders = dbSheet.getRange(2, 1, 1, dbSheet.getLastColumn()).getValues()[0];
  const dbData = dbSheet.getRange(3, 1, dbSheet.getLastRow() - 2, dbHeaders.length).getValues();
  let staticInfo = null;
  for (const row of dbData) {
    if (String(row[dbHeaders.indexOf('유한 품번')]).trim() === yuhanPartNo.trim()) {
      staticInfo = {
        itemName: row[dbHeaders.indexOf('품명')],
        packSize: row[dbHeaders.indexOf('입수량')],
        itemsPerPallet: row[dbHeaders.indexOf('1PLT')]
      };
      break;
    }
  }
  if (!staticInfo) throw new Error("기본정보에 해당 품목코드가 없습니다.");
  const invSheet = ss.getSheetByName(CONFIG.ORDER_MGMT.INVENTORY_SHEET);
  if (!invSheet) throw new Error(`시트 '${CONFIG.ORDER_MGMT.INVENTORY_SHEET}'를 찾을 수 없습니다.`);
  const invHeaders = invSheet.getRange(1, 1, 1, invSheet.getLastColumn()).getValues()[0];
  const invData = invSheet.getRange(2, 1, invSheet.getLastRow() - 1, invHeaders.length).getValues();
  const codeIdx = invHeaders.indexOf('품목코드');
  const lotIdx = invHeaders.indexOf('LOT');
  const qtyIdx = invHeaders.indexOf('수량');
  const mfgDateIdx = invHeaders.indexOf('제조일자');
  const expDateIdx = invHeaders.indexOf('유통기한');
  const lots = [];
  for (const row of invData) {
    if (String(row[codeIdx]).trim() === yuhanPartNo.trim() && Number(row[qtyIdx]) > 0) {
      const mfgDateRaw = row[mfgDateIdx];
      const expDateRaw = row[expDateIdx];
      lots.push({
        lotNumber: row[lotIdx], quantity: row[qtyIdx],
        mfgDate: mfgDateRaw ? Utilities.formatDate(parseDateString(mfgDateRaw), Session.getScriptTimeZone(), "yyyy-MM-dd") : '',
        expDate: expDateRaw ? Utilities.formatDate(parseDateString(expDateRaw), Session.getScriptTimeZone(), "yyyy-MM-dd") : ''
      });
    }
  }
  return { staticInfo, lots };
}

function saveReceivedStock(receivedItems) {
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.ORDER_MGMT.SSID).getSheetByName(CONFIG.ORDER_MGMT.INVENTORY_SHEET);
    if (!sheet) return { success: false, message: `'${CONFIG.ORDER_MGMT.INVENTORY_SHEET}' 시트를 찾을 수 없습니다.` };
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const headerMap = new Map(headers.map((h, i) => [h, i]));
    const rowsToAppend = receivedItems.map(item => {
      const newRow = new Array(headers.length).fill('');
      if (headerMap.has("품목코드")) newRow[headerMap.get("품목코드")] = item.itemCode || '';
      if (headerMap.has("제품명")) newRow[headerMap.get("제품명")] = item.itemName || '';
      if (headerMap.has("입수")) newRow[headerMap.get("입수")] = item.packSize || '';
      if (headerMap.has("BOX수량")) newRow[headerMap.get("BOX수량")] = item.boxQty || '';
      if (headerMap.has("수량")) newRow[headerMap.get("수량")] = item.quantity || 0;
      if (headerMap.has("LOT")) newRow[headerMap.get("LOT")] = item.lot || '';
      if (headerMap.has("제조일자")) newRow[headerMap.get("제조일자")] = item.mfgDate ? parseDateString(item.mfgDate) : '';
      if (headerMap.has("유통기한")) newRow[headerMap.get("유통기한")] = item.expDate ? parseDateString(item.expDate) : '';
      if (headerMap.has("파레트수량")) newRow[headerMap.get("파레트수량")] = item.palletQty || '';
      if (headerMap.has("비고")) newRow[headerMap.get("비고")] = item.remarks || '';
      return newRow;
    });
    if (rowsToAppend.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, headers.length).setValues(rowsToAppend);
      return { success: true, message: `${rowsToAppend.length}건의 입고 내역이 성공적으로 저장되었습니다.` };
    } else { return { success: false, message: '저장할 입고 품목이 없습니다.' }; }
  } catch (e) { Logger.log("Error in saveReceivedStock: " + e.toString()); return { success: false, message: '입고 내역 저장 중 오류 발생: ' + e.message }; }
}

function updateInventoryLotDetail(updateData) {
  try {
    const { sheetRowIndex, newData } = updateData;
    if (!sheetRowIndex || isNaN(sheetRowIndex) || sheetRowIndex < 2) return { success: false, message: '유효하지 않은 시트 행 번호입니다: ' + sheetRowIndex };
    const sheet = SpreadsheetApp.openById(CONFIG.ORDER_MGMT.SSID).getSheetByName(CONFIG.ORDER_MGMT.INVENTORY_SHEET);
    if (!sheet) return { success: false, message: `'${CONFIG.ORDER_MGMT.INVENTORY_SHEET}' 시트를 찾을 수 없습니다.` };
    if (sheetRowIndex > sheet.getLastRow()) return { success: false, message: `수정할 행(${sheetRowIndex})이 시트 범위를 벗어났습니다.` };
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const headerMap = new Map(headers.map((h, i) => [h, i + 1]));
    const fieldsToUpdate = {
      "LOT": newData.lot, "수량": newData.quantity, "제조일자": newData.mfgDate ? parseDateString(newData.mfgDate) : null,
      "유통기한": newData.expDate ? parseDateString(newData.expDate) : null, "파레트수량": newData.palletQty, "비고": newData.remarks
    };
    let updated = false;
    for (const fieldName in fieldsToUpdate) {
      const colIndex = headerMap.get(fieldName);
      if (colIndex) {
        let valueToSet = fieldsToUpdate[fieldName];
        if (valueToSet === '') valueToSet = null;
        sheet.getRange(sheetRowIndex, colIndex).setValue(valueToSet);
        updated = true;
      }
    }
    if (updated) return { success: true, message: `재고 정보(시트 ${sheetRowIndex}행)가 성공적으로 수정되었습니다.` };
    else return { success: false, message: `수정할 필드를 찾지 못했거나 데이터가 없습니다. (시트 헤더 확인 필요)` };
  } catch (e) { Logger.log(`Error in updateInventoryLotDetail (row ${updateData.sheetRowIndex}): ${e.toString()}`); return { success: false, message: `재고 정보 수정 중 오류 발생: ${e.message}` }; }
}

function deleteInventoryLotItem(sheetRowIndex) {
  try {
    if (!sheetRowIndex || isNaN(sheetRowIndex) || sheetRowIndex < 2) return { success: false, message: '유효하지 않은 시트 행 번호입니다: ' + sheetRowIndex };
    const sheet = SpreadsheetApp.openById(CONFIG.ORDER_MGMT.SSID).getSheetByName(CONFIG.ORDER_MGMT.INVENTORY_SHEET);
    if (!sheet) return { success: false, message: `'${CONFIG.ORDER_MGMT.INVENTORY_SHEET}' 시트를 찾을 수 없습니다.` };
    if (sheetRowIndex > sheet.getLastRow()) return { success: false, message: `삭제할 행(${sheetRowIndex})이 시트 범위를 벗어났습니다.` };
    sheet.deleteRow(sheetRowIndex);
    return { success: true, message: `재고(시트 ${sheetRowIndex}행)가 성공적으로 삭제되었습니다.` };
  } catch (e) { Logger.log(`Error in deleteInventoryLotItem (row ${sheetRowIndex}): ${e.toString()}`); return { success: false, message: `재고 삭제 중 오류 발생: ${e.message}` }; }
}

// --- 발주 (발주현황 시트) 관련 함수 ---
function submitOrderToSheet(orders) {
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.ORDER_MGMT.SSID).getSheetByName(CONFIG.ORDER_MGMT.ORDER_SHEET);
    if (!sheet) return { success: false, message: `'${CONFIG.ORDER_MGMT.ORDER_SHEET}' 시트를 찾을 수 없습니다.` };
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const headerMap = new Map(headers.map((h, i) => [h, i]));
    const requiredHeaders = ['발주일', '유한품번', '지에스켐 품번', '품명', '수량', '납기일', '사업부'];
    for (const rh of requiredHeaders) if (!headerMap.has(rh)) return { success: false, message: `'${CONFIG.ORDER_MGMT.ORDER_SHEET}' 시트에 필수 헤더 '${rh}'가 없습니다.` };
    const valuesToAppend = orders.map(order => {
      const rowData = new Array(headers.length).fill('');
      rowData[headerMap.get('발주일')] = parseDateString(order.issueDate);
      rowData[headerMap.get('사업부')] = order.businessUnit;
      rowData[headerMap.get('유한품번')] = order.yuhanPartNo;
      rowData[headerMap.get('지에스켐 품번')] = order.gskemPartNo;
      rowData[headerMap.get('품명')] = order.itemName;
      rowData[headerMap.get('수량')] = Number(order.quantity);
      rowData[headerMap.get('납기일')] = parseDateString(order.deliveryDate);
      return rowData;
    });
    if (valuesToAppend.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, valuesToAppend.length, headers.length).setValues(valuesToAppend);
      return { success: true, message: '발주서가 성공적으로 기록되었습니다.' };
    } else return { success: false, message: '제출할 유효한 발주 품목이 없습니다.' };
  } catch (e) { Logger.log(`submitOrderToSheet Error: ${e.message}`); return { success: false, message: '데이터 기록 중 오류: ' + e.message }; }
}

function deleteOrderRow(rowIdx) {
  if (!rowIdx || isNaN(rowIdx) || rowIdx < 2) return { success: false, message: '유효하지 않은 행 번호입니다.' };
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.ORDER_MGMT.SSID).getSheetByName(CONFIG.ORDER_MGMT.ORDER_SHEET);
    if (!sheet) return { success: false, message: `'${CONFIG.ORDER_MGMT.ORDER_SHEET}' 시트를 찾을 수 없습니다.` };
    if (rowIdx > sheet.getLastRow()) return { success: false, message: '삭제할 행이 시트 범위를 벗어났습니다.' };
    sheet.deleteRow(rowIdx);
    return { success: true, message: `발주 내역 ${rowIdx}행이 성공적으로 삭제되었습니다.` };
  } catch (e) { Logger.log(`deleteOrderRow Error: ${e.message}`); return { success: false, message: `행 삭제 중 오류 발생: ${e.message}` }; }
}

function getOrdersByDateRange(filterOptions) {
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.ORDER_MGMT.SSID).getSheetByName(CONFIG.ORDER_MGMT.ORDER_SHEET);
    if (!sheet || sheet.getLastRow() < 1) return [];
    const allSheetValues = sheet.getDataRange().getValues();
    const headers = allSheetValues.shift().map(h => String(h).trim());
    const headerMap = new Map(headers.map((h, i) => [h, i]));
    const clientHeaders = ['발주일', '사업부', '유한품번', '지에스켐 품번', '품명', '수량', '납기일'];
    let missingHeaders = clientHeaders.filter(ch => !headerMap.has(ch));
    if (missingHeaders.length > 0) throw new Error(`'${CONFIG.ORDER_MGMT.ORDER_SHEET}' 시트 1행에서 다음 필수 헤더를 찾을 수 없습니다: ${missingHeaders.join(', ')}.`);
    const yuhanPartNoFilter = filterOptions ? String(filterOptions.yuhanPartNo || "").trim().toLowerCase() : "";
    let filteredRows = allSheetValues.filter(row => {
      if (yuhanPartNoFilter) {
        const partNoFromSheet = String(row[headerMap.get('유한품번')] || "").toLowerCase();
        return partNoFromSheet.includes(yuhanPartNoFilter);
      }
      return true;
    }).map((row, index) => ({ data: row, originalIndex: index + 2 }));
    filteredRows.sort((a, b) => (parseDateString(b.data[headerMap.get('발주일')]) || 0) - (parseDateString(a.data[headerMap.get('발주일')]) || 0));
    const resultForClient = filteredRows.map(item => {
      const row = item.data;
      const formattedRow = clientHeaders.map(headerName => {
        const cellValue = row[headerMap.get(headerName)];
        if (headerName === '발주일' || headerName === '납기일') {
          const parsedDate = parseDateString(cellValue);
          return parsedDate ? Utilities.formatDate(parsedDate, Session.getScriptTimeZone(), "yyyy-MM-dd") : (cellValue || '');
        }
        return cellValue !== null && cellValue !== undefined ? cellValue.toString() : '';
      });
      formattedRow.push(item.originalIndex);
      return formattedRow;
    });
    return [clientHeaders, ...resultForClient];
  } catch (e) { Logger.log(`getOrdersByDateRange Error: ${e.message}`); throw e; }
}


// --- 생산계획 (생산계획 시트) 관련 함수 ---
function saveProductionPlanItems(planDataArray) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ORDER_MGMT.SSID);
    const sheetName = CONFIG.ORDER_MGMT.PRODUCTION_PLAN_SHEET;
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
    } else return { success: false, message: "저장할 유효한 품목 데이터가 없습니다." };
  } catch (e) { Logger.log(`saveProductionPlanItems Error: ${e.message}`); return { success: false, message: "생산 계획 저장 중 오류 발생: " + e.message }; }
}

function getProductionPlansForCalendar(year, month) {
  const plans = [];
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.ORDER_MGMT.SSID).getSheetByName(CONFIG.ORDER_MGMT.PRODUCTION_PLAN_SHEET);
    if (!sheet || sheet.getLastRow() < 2) return plans;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const headerMap = new Map(headers.map((h, i) => [h, i]));
    const dateColIdx = headerMap.get("생산일");
    if (dateColIdx === undefined) return plans;
    const dataValues = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
    const targetMonth = parseInt(month, 10) - 1;
    const targetYear = parseInt(year, 10);
    dataValues.forEach((row, index) => {
      let productionDateObj = parseDateString(row[dateColIdx]);
      if (productionDateObj && productionDateObj.getFullYear() === targetYear && productionDateObj.getMonth() === targetMonth) {
        plans.push({
          originalSheetRowIndex: index + 2,
          date: Utilities.formatDate(productionDateObj, Session.getScriptTimeZone(), "yyyy-MM-dd"),
          gskemPartNo: String(row[headerMap.get("지에스켐 품번")] || ""),
          yuhanPartNo: String(row[headerMap.get("유한품번")] || ""),
          itemName: String(row[headerMap.get("품명")] || ""),
          quantity: String(row[headerMap.get("수량")] || "")
        });
      }
    });
  } catch (e) { Logger.log("getProductionPlansForCalendar Error: " + e.toString()); }
  return plans;
}

function deleteProductionPlan(sheetRowIndex) {
  try {
    if (!sheetRowIndex || isNaN(sheetRowIndex) || sheetRowIndex < 2) return { success: false, message: '유효하지 않은 행 번호입니다.' };
    const sheet = SpreadsheetApp.openById(CONFIG.ORDER_MGMT.SSID).getSheetByName(CONFIG.ORDER_MGMT.PRODUCTION_PLAN_SHEET);
    if (!sheet) return { success: false, message: `'${CONFIG.ORDER_MGMT.PRODUCTION_PLAN_SHEET}' 시트를 찾을 수 없습니다.` };
    if (sheetRowIndex > sheet.getLastRow()) return { success: false, message: `삭제할 행(${sheetRowIndex})이 시트 범위를 벗어났습니다.` };
    sheet.deleteRow(sheetRowIndex);
    return { success: true, message: `생산 계획 (시트 ${sheetRowIndex}행)이 성공적으로 삭제되었습니다.` };
  } catch (e) { Logger.log(`deleteProductionPlan Error: ${e.message}`); return { success: false, message: `생산 계획 삭제 중 오류 발생: ${e.message}` }; }
}

function updateProductionPlanItem(updateInfo) {
  try {
    const { rowIndex, newData } = updateInfo;
    if (!rowIndex || isNaN(rowIndex) || rowIndex < 2) return { success: false, message: '유효하지 않은 행 번호입니다.' };
    if (!newData || typeof newData !== 'object') return { success: false, message: '수정할 데이터가 올바르지 않습니다.' };
    const sheet = SpreadsheetApp.openById(CONFIG.ORDER_MGMT.SSID).getSheetByName(CONFIG.ORDER_MGMT.PRODUCTION_PLAN_SHEET);
    if (!sheet) return { success: false, message: `'${CONFIG.ORDER_MGMT.PRODUCTION_PLAN_SHEET}' 시트를 찾을 수 없습니다.` };
    if (rowIndex > sheet.getLastRow()) return { success: false, message: `수정할 행(${rowIndex})이 시트 범위를 벗어났습니다.` };
    const valuesToUpdate = [
      parseDateString(newData.productionDate) || '', newData.gskemPartNo || '', newData.yuhanPartNo || '',
      newData.itemName || '', Number(newData.quantity) || 0
    ];
    sheet.getRange(rowIndex, 1, 1, valuesToUpdate.length).setValues([valuesToUpdate]);
    return { success: true, message: `생산 계획 (시트 ${rowIndex}행)이 성공적으로 수정되었습니다.` };
  } catch (e) { Logger.log(`updateProductionPlanItem Error: ${e.message}`); return { success: false, message: `생산 계획 수정 중 오류 발생: ${e.message}` }; }
}

// --- 출고 (출고요청, 납품이력 시트) 관련 함수 ---
function submitShipmentRequest(items) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ORDER_MGMT.SSID);
    let sheet = ss.getSheetByName(CONFIG.ORDER_MGMT.SHIPPING_REQUEST_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.ORDER_MGMT.SHIPPING_REQUEST_SHEET);
      sheet.appendRow(['요청일', '품목코드', '품명', 'LOT', '수량', 'BOX수량', '파렛트수량', '상태', '입수', '제조일자', '유통기한']);
    }
    const logs = items.map(item => [
      parseDateString(item.shippingDate), item.itemCode, item.itemName, item.lotNumber,
      item.quantity, item.boxQty, item.palletQty, '확인 대기',
      item.packSize, parseDateString(item.mfgDate), parseDateString(item.expDate)
    ]);
    if (logs.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, logs.length, logs[0].length).setValues(logs);
    return { success: true, message: `${items.length}건의 출고 요청이 등록되었습니다.` };
  } catch (e) { Logger.log(`submitShipmentRequest Error: ${e.message}`); return { success: false, message: `요청 등록 중 오류 발생: ${e.message}` }; }
}

function getPendingShipments() {
  const sheet = SpreadsheetApp.openById(CONFIG.ORDER_MGMT.SSID).getSheetByName(CONFIG.ORDER_MGMT.SHIPPING_REQUEST_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const headerMap = new Map(headers.map((h, i) => [h, i]));
  const pendingRequests = data.map((row, index) => {
    if (String(row[headerMap.get('상태')]) !== '확인 대기') return null;
    let request = { rowId: index + 2 };
    for (const [header, i] of headerMap.entries()) {
      let key;
      switch(header) {
        case '요청일': key = 'shippingDate'; break; case '품목코드': key = 'itemCode'; break;
        case '품명': key = 'itemName'; break; case 'LOT': key = 'lotNumber'; break;
        case '수량': key = 'quantity'; break; case 'BOX수량': key = 'boxQty'; break;
        case '파렛트수량': key = 'palletQty'; break; case '입수': key = 'packSize'; break;
        case '제조일자': key = 'mfgDate'; break; case '유통기한': key = 'expDate'; break;
      }
      if (key) {
        if ((key === 'shippingDate' || key === 'mfgDate' || key === 'expDate') && row[i] instanceof Date) {
          request[key] = Utilities.formatDate(row[i], Session.getScriptTimeZone(), "yyyy-MM-dd");
        } else request[key] = row[i];
      }
    }
    return request;
  }).filter(Boolean);
  pendingRequests.sort((a, b) => new Date(b.shippingDate) - new Date(a.shippingDate));
  return pendingRequests;
}

function updateShipmentRequest(requestData) {
  try {
    const { rowId, itemCode, newDate, newQuantity } = requestData;
    const ss = SpreadsheetApp.openById(CONFIG.ORDER_MGMT.SSID);
    const dbSheet = ss.getSheetByName(CONFIG.ORDER_MGMT.DB_SHEET);
    const dbHeaders = dbSheet.getRange(2, 1, 1, dbSheet.getLastColumn()).getValues()[0];
    const dbData = dbSheet.getRange(3, 1, dbSheet.getLastRow() - 2, dbHeaders.length).getValues();
    let packSize = 0, itemsPerPallet = 0;
    for (const row of dbData) {
      if (String(row[dbHeaders.indexOf('유한 품번')]).trim() === itemCode) {
        packSize = Number(row[dbHeaders.indexOf('입수량')]);
        itemsPerPallet = Number(row[dbHeaders.indexOf('1PLT')]);
        break;
      }
    }
    if (packSize > 0 && newQuantity % packSize !== 0) return { success: false, message: `수량은 BOX 단위(${packSize}개)로 입력해야 합니다.` };
    const shippingSheet = ss.getSheetByName(CONFIG.ORDER_MGMT.SHIPPING_REQUEST_SHEET);
    const headers = shippingSheet.getRange(1, 1, 1, shippingSheet.getLastColumn()).getValues()[0];
    const headerMap = new Map(headers.map((h, i) => [h, i + 1]));
    shippingSheet.getRange(rowId, headerMap.get('요청일')).setValue(parseDateString(newDate));
    shippingSheet.getRange(rowId, headerMap.get('수량')).setValue(newQuantity);
    if (headerMap.has('BOX수량')) shippingSheet.getRange(rowId, headerMap.get('BOX수량')).setValue(packSize > 0 ? newQuantity / packSize : 0);
    if (headerMap.has('파렛트수량')) shippingSheet.getRange(rowId, headerMap.get('파렛트수량')).setValue(itemsPerPallet > 0 ? Math.ceil(newQuantity / itemsPerPallet) : 0);
    return { success: true, message: "요청이 수정되었습니다." };
  } catch(e) { Logger.log(`updateShipmentRequest Error: ${e.message}`); return { success: false, message: `요청 수정 중 오류: ${e.message}` }; }
}

function deleteShipmentRequest(rowId) {
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.ORDER_MGMT.SSID).getSheetByName(CONFIG.ORDER_MGMT.SHIPPING_REQUEST_SHEET);
    sheet.deleteRow(rowId);
    return { success: true, message: "요청이 삭제되었습니다." };
  } catch (e) { Logger.log(`deleteShipmentRequest Error: ${e.message}`); return { success: false, message: e.message }; }
}

function confirmShipment(rowId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ORDER_MGMT.SSID);
    const shippingSheet = ss.getSheetByName(CONFIG.ORDER_MGMT.SHIPPING_REQUEST_SHEET);
    const invSheet = ss.getSheetByName(CONFIG.ORDER_MGMT.INVENTORY_SHEET);
    const historySheet = ss.getSheetByName(CONFIG.ORDER_MGMT.DELIVERY_HISTORY_SHEET);
    const reqHeaders = shippingSheet.getRange(1, 1, 1, shippingSheet.getLastColumn()).getValues()[0];
    const reqRow = shippingSheet.getRange(rowId, 1, 1, reqHeaders.length).getValues()[0];
    const reqHeaderMap = new Map(reqHeaders.map((h, i) => [h, i]));
    const reqStatus = String(reqRow[reqHeaderMap.get('상태')]);
    if (reqStatus !== '확인 대기') return { success: false, message: '이미 처리되었거나 취소된 요청입니다.' };
    const reqCode = reqRow[reqHeaderMap.get('품목코드')];
    const reqLot = reqRow[reqHeaderMap.get('LOT')];
    const reqQty = Number(reqRow[reqHeaderMap.get('수량')]);
    const invValues = invSheet.getDataRange().getValues();
    const invHeaders = invValues.shift();
    const invHeaderMap = new Map(invHeaders.map((h, i) => [h, i]));
    let targetRowIndex = -1;
    for (let i = 0; i < invValues.length; i++) {
      if (String(invValues[i][invHeaderMap.get('품목코드')]) === reqCode && String(invValues[i][invHeaderMap.get('LOT')]) === reqLot) {
        targetRowIndex = i;
        break;
      }
    }
    if (targetRowIndex === -1) throw new Error(`재고 없음: 출고하려는 품목(LOT: ${reqLot})을 재고에서 찾을 수 없습니다.`);
    const currentQty = Number(invValues[targetRowIndex][invHeaderMap.get('수량')]);
    if (reqQty > currentQty) throw new Error(`재고 부족: 요청수량(${reqQty})이 현재고(${currentQty})보다 많습니다.`);
    const newQty = currentQty - reqQty;
    const actualSheetRow = targetRowIndex + 2;
    if (newQty <= 0) invSheet.deleteRow(actualSheetRow);
    else invSheet.getRange(actualSheetRow, invHeaderMap.get('수량') + 1).setValue(newQty);
    const historyLog = [
      new Date(), reqRow[reqHeaderMap.get('품목코드')], reqRow[reqHeaderMap.get('품명')],
      reqRow[reqHeaderMap.get('수량')], reqRow[reqHeaderMap.get('LOT')],
      reqRow[reqHeaderMap.get('제조일자')], reqRow[reqHeaderMap.get('유통기한')]
    ];
    historySheet.appendRow(historyLog);
    shippingSheet.getRange(rowId, reqHeaderMap.get('상태') + 1).setValue('출고 완료');
    return { success: true, message: `출고 처리 완료! (품목: ${reqCode}, 수량: ${reqQty})` };
  } catch (e) { Logger.log(`confirmShipment Error: ${e.message}`); return { success: false, message: e.message }; } finally { lock.releaseLock(); }
}

function getAvailableHistoryYears() {
  const sheet = SpreadsheetApp.openById(CONFIG.ORDER_MGMT.SSID).getSheetByName(CONFIG.ORDER_MGMT.DELIVERY_HISTORY_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [new Date().getFullYear()];
  const dateColumn = sheet.getRange("A2:A" + sheet.getLastRow()).getValues();
  const years = new Set(dateColumn.map(row => row[0] instanceof Date ? row[0].getFullYear() : null).filter(Boolean));
  return Array.from(years).sort((a, b) => b - a);
}

function getDeliveryHistory(filters) {
  const sheet = SpreadsheetApp.openById(CONFIG.ORDER_MGMT.SSID).getSheetByName(CONFIG.ORDER_MGMT.DELIVERY_HISTORY_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const headerMap = new Map(headers.map((h, i) => [h, i]));
  const filteredData = data.filter(row => {
    const rowDate = parseDateString(row[headerMap.get('납품일자')]);
    if (!rowDate) return false;
    if (filters.year && rowDate.getFullYear() != filters.year) return false;
    if (filters.month && (rowDate.getMonth() + 1) != filters.month) return false;
    const rowCode = String(row[headerMap.get('품목코드')] || "").trim();
    if (filters.itemCode && !rowCode.includes(filters.itemCode)) return false;
    return true;
  });
  const aggregationMap = {};
  filteredData.forEach(row => {
    const itemCode = String(row[headerMap.get('품목코드')]);
    if (!aggregationMap[itemCode]) {
      aggregationMap[itemCode] = {
        itemCode: itemCode, itemName: String(row[headerMap.get('품명')]),
        grandTotalQuantity: 0, transactions: []
      };
    }
    const quantity = Number(row[headerMap.get('수량')]) || 0;
    aggregationMap[itemCode].grandTotalQuantity += quantity;
    aggregationMap[itemCode].transactions.push({
      date: row[headerMap.get('납품일자')] instanceof Date ? Utilities.formatDate(row[headerMap.get('납품일자')], Session.getScriptTimeZone(), "yyyy-MM-dd") : '',
      lot: String(row[headerMap.get('LOT')]), quantity: quantity,
      mfgDate: row[headerMap.get('제조일자')] instanceof Date ? Utilities.formatDate(row[headerMap.get('제조일자')], Session.getScriptTimeZone(), "yyyy-MM-dd") : '',
      expDate: row[headerMap.get('유효일자')] instanceof Date ? Utilities.formatDate(row[headerMap.get('유효일자')], Session.getScriptTimeZone(), "yyyy-MM-dd") : ''
    });
  });
  return Object.values(aggregationMap);
}


/****************************************************************
 * * [공통 유틸리티 함수]
 * ****************************************************************/
function parseDateString(dateString) {
  if (!dateString) return null;
  if (dateString instanceof Date && !isNaN(dateString)) return new Date(Date.UTC(dateString.getFullYear(), dateString.getMonth(), dateString.getDate()));
  if (typeof dateString !== 'string') return null;
  dateString = dateString.trim();
  if (dateString === "") return null;
  let date, parts;
  parts = dateString.match(/^(\d{4})[-\.\/](\d{1,2})[-\.\/](\d{1,2})$/);
  if (parts) { date = new Date(Date.UTC(parseInt(parts[1], 10), parseInt(parts[2], 10) - 1, parseInt(parts[3], 10))); if (!isNaN(date)) return date; }
  parts = dateString.match(/^(\d{1,2})[-\.\/](\d{1,2})[-\.\/](\d{4})$/);
  if (parts) { date = new Date(Date.UTC(parseInt(parts[3], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10))); if (!isNaN(date)) return date; }
  parts = dateString.match(/^(\d{2})[-\.\/](\d{1,2})[-\.\/](\d{1,2})$/);
  if (parts) { let year = parseInt(parts[1], 10); year += (year > 50 ? 1900 : 2000); date = new Date(Date.UTC(year, parseInt(parts[2], 10) - 1, parseInt(parts[3], 10))); if (!isNaN(date)) return date; }
  if (!isNaN(parseFloat(dateString)) && isFinite(dateString)) {
    const num = parseFloat(dateString);
    if (num > 25569) { const excelEpoch = new Date(Date.UTC(1899, 11, 30)); date = new Date(excelEpoch.getTime() + (num - 1) * 24 * 60 * 60 * 1000); if (!isNaN(date)) return date; }
  }
  date = new Date(dateString);
  if (!isNaN(date)) return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  return null;
}
