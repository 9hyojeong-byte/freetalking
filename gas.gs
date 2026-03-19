function doPost(e) {
  try {
    // React 앱에서 보낸 JSON 데이터 파싱
    var data = JSON.parse(e.postData.contents);
    
    var userText = data.user || "";
    var aiText = data.ai || "";
    var time = data.time || new Date().toISOString();
    
    // 현재 연결된 스프레드시트의 활성화된 시트 가져오기
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    
    // 시트가 비어있다면 첫 번째 행에 헤더(제목) 추가
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Time", "User", "AI"]);
      // 헤더 스타일 지정 (선택 사항)
      sheet.getRange("A1:C1").setFontWeight("bold").setBackground("#f3f3f3");
    }
    
    // 새로운 행에 데이터 추가
    sheet.appendRow([time, userText, aiText]);
    
    // 성공 응답 반환
    return ContentService.createTextOutput(JSON.stringify({ "status": "success" }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    // 에러 발생 시 응답
    return ContentService.createTextOutput(JSON.stringify({ "status": "error", "message": error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
