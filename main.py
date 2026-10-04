import sys
import json
import pandas as pd
import random       # ★ AI 셔플 및 시뮬레이션을 위한 도구
import copy         # ★ 데이터 복사를 위한 도구
import re           # ★ 괄호 안의 숫자를 귀신같이 빼내는 판독기용 도구
from PyQt6.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, 
                             QHBoxLayout, QLabel, QPushButton, QFileDialog, 
                             QTableWidget, QTableWidgetItem, QHeaderView, QMessageBox,
                             QSpinBox, QLineEdit, QDialog, QDialogButtonBox, 
                             QAbstractItemView, QScrollArea, QComboBox, QCheckBox,
                             QTabWidget) # ★ QTabWidget 추가
from PyQt6.QtGui import QColor # 색상 적용을 위해 추가
from PyQt6.QtCore import Qt
# ★ 신규 추가: 엑셀 파일을 예쁘게 꾸며줄 도구 상자 꺼내기!
from openpyxl.styles import PatternFill, Border, Side, Alignment, Font

# =====================================================================
# ★ 신규 추가: 자습(노란색) / 제외(빨간색 취소선) 2줄 토글 버튼 커스텀 부품!
# =====================================================================
class SubjectCellWidget(QWidget):
    def __init__(self, max_classes):
        super().__init__()
        self.setMinimumHeight(110) # ★ 2줄이 들어가야 하므로 높이를 110으로 넉넉하게 확장!
        layout = QVBoxLayout()
        layout.setContentsMargins(2, 2, 2, 2)
        layout.setSpacing(2)
        
        # 1. 과목명 입력칸
        self.subj_input = QLineEdit()
        self.subj_input.setPlaceholderText("과목명 입력")
        self.subj_input.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.subj_input.setStyleSheet("border: 1px solid #ced4da; border-radius: 3px; padding: 2px;")
        layout.addWidget(self.subj_input)

        # 2. 🟡 자습반 토글 버튼들
        lay_study = QHBoxLayout()
        lay_study.setSpacing(1)
        lay_study.addWidget(QLabel("<span style='font-size:10px; color:#d35400; font-weight:bold;'>자습</span>"))
        self.study_btns = []
        for i in range(1, max_classes + 1):
            btn = QPushButton(str(i))
            btn.setCheckable(True)
            btn.setStyleSheet("""
                QPushButton { background-color: #f8f9fa; border: 1px solid #adb5bd; padding: 1px; font-size: 10px; border-radius: 2px; }
                QPushButton:checked { background-color: #ffe066; border: 1px solid #f5b041; color: #d35400; font-weight: bold; }
            """)
            lay_study.addWidget(btn)
            self.study_btns.append(btn)
        layout.addLayout(lay_study)

        # 3. 🔴 제외반 토글 버튼들
        lay_exclude = QHBoxLayout()
        lay_exclude.setSpacing(1)
        lay_exclude.addWidget(QLabel("<span style='font-size:10px; color:#c0392b; font-weight:bold;'>제외</span>"))
        self.exclude_btns = []
        for i in range(1, max_classes + 1):
            btn = QPushButton(str(i))
            btn.setCheckable(True)
            # 체크되면 빨간색 텍스트에 취소선이 쫙! 그어지는 디자인
            btn.setStyleSheet("""
                QPushButton { background-color: #f8f9fa; border: 1px solid #adb5bd; padding: 1px; font-size: 10px; border-radius: 2px; }
                QPushButton:checked { background-color: #ffb3ba; border: 1px solid #e74c3c; color: #c0392b; font-weight: bold; text-decoration: line-through; }
            """)
            lay_exclude.addWidget(btn)
            self.exclude_btns.append(btn)
        layout.addLayout(lay_exclude)

        self.setLayout(layout)

# =====================================================================
# ★ 신규 추가: 엑셀 복사/붙여넣기(Ctrl+V)를 지원하는 전용 표
# =====================================================================
class PasteTableWidget(QTableWidget):
    def keyPressEvent(self, event):
        # Ctrl + V 를 누르면 작동하는 마법
        if event.modifiers() == Qt.KeyboardModifier.ControlModifier and event.key() == Qt.Key.Key_V:
            clipboard = QApplication.clipboard()
            text = clipboard.text()
            if not text: return
            
            rows = text.strip().split('\n')
            current_row = self.currentRow()
            current_col = self.currentColumn()
            if current_row < 0 or current_col < 0: return

            for r, row_text in enumerate(rows):
                cols = row_text.split('\t')
                for c, col_text in enumerate(cols):
                    target_row = current_row + r
                    target_col = current_col + c
                    # 1~3학년 과목 칸(3,4,5열)에만 붙여넣기 허용!
                    if target_row < self.rowCount() and 3 <= target_col <= 5:
                        item = self.item(target_row, target_col)
                        if not item:
                            item = QTableWidgetItem()
                            item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                            self.setItem(target_row, target_col, item)
                        item.setText(col_text.strip())
        else:
            super().keyPressEvent(event)

# =====================================================================
# ★ 신규 추가: 과목 일괄 입력 팝업창
# =====================================================================
class SubjectInputDialog(QDialog):
    def __init__(self, schedule_data, parent=None):
        super().__init__(parent)
        self.setWindowTitle("⌨️ 과목 일괄 입력 (엑셀 복사/붙여넣기 가능)")
        self.resize(700, 500)
        layout = QVBoxLayout(self)

        info = QLabel("💡 엑셀에서 과목명들을 드래그해서 복사(Ctrl+C)한 뒤, 표의 시작 칸을 클릭하고 붙여넣기(Ctrl+V) 하세요!\n※ 탭(Tab)키와 방향키 이동도 완벽하게 지원됩니다. 자습반 지정은 입력 완료 후 메인 화면 노란색 버튼으로 해주세요.")
        info.setStyleSheet("color: #2980b9; font-weight: bold; margin-bottom: 5px;")
        layout.addWidget(info)

        self.table = PasteTableWidget()
        self.table.setColumnCount(6)
        
        # ★ 추가: 타자를 바로 치면 한글이 씹히므로, [더블클릭] 이나 [Enter키]를 눌러야만 편집이 켜지도록 잠금!
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.DoubleClicked | QAbstractItemView.EditTrigger.EditKeyPressed)

        self.table.setHorizontalHeaderLabels(['일차', '시험일', '교시', '1학년', '2학년', '3학년'])
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        self.table.verticalHeader().setVisible(False)
        self.table.setStyleSheet("gridline-color: #bdc3c7; border: 1px solid #bdc3c7;")
        layout.addWidget(self.table)

        self.table.setRowCount(len(schedule_data))
        for r, row_data in enumerate(schedule_data):
            for c in range(3): 
                item = QTableWidgetItem(row_data[c])
                item.setFlags(item.flags() & ~Qt.ItemFlag.ItemIsEditable)
                item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                item.setBackground(Qt.GlobalColor.lightGray)
                self.table.setItem(r, c, item)
            for c in range(3, 6): 
                item = QTableWidgetItem(row_data[c])
                item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                self.table.setItem(r, c, item)

        btn_box = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        btn_box.accepted.connect(self.accept)
        btn_box.rejected.connect(self.reject)
        layout.addWidget(btn_box)

# =====================================================================
# ★ 신규 추가: 프로그램 종합 사용 설명서 팝업창
# =====================================================================

class HelpDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("📖 스마트 시험 감독 배정 프로그램 - 마스터 가이드")
        self.resize(850, 750) # 내용을 위해 창 크기를 조금 더 키웠습니다.
        layout = QVBoxLayout(self)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        content_widget = QWidget()
        content_layout = QVBoxLayout(content_widget)
        content_layout.setSpacing(20) # 문단 사이 간격 확대

        guide_text = """
        <div style='line-height: 1.8;'>
            <h1 style='color: #2c3e50; text-align: center; border-bottom: 2px solid #2c3e50; padding-bottom: 10px;'>🚀 시험 감독 배정 완벽 마스터 가이드</h1>
            <p style='text-align: center; color: #7f8c8d;'>이 가이드는 화면의 <b>왼쪽 위에서 오른쪽 아래로</b> 이동하며 작성하는 순서에 최적화되어 있습니다.</p>

            <h2 style='color: #e67e22; border-left: 5px solid #e67e22; padding-left: 10px;'>1단계: 배정 회차 및 전역 옵션 (화면 맨 위)</h2>
            <p>배정을 시작하기 전, 이번 시험의 성격에 맞는 옵션을 먼저 체크하세요.</p>
            <ul>
                <li><b>📌 배정 회차 선택:</b> 2차~4차 고사 선택 시, 배정 시작 단계에서 <b>이전 고사의 엑셀 파일(결과_시수표)</b>을 불러와 누적 시수를 합산할 수 있습니다.</li>
                <li><b>🚨 3학년 담임/부장 제외:</b> '4차 고사' 선택 시에만 활성화됩니다. 수능 이후 프로그램으로 바쁜 3학년 담임과 부장님을 시험 감독 명단에서 즉시 제외합니다.</li>
                <li><b>☑️ 전체 자습 시 교실 감독:</b> 체크 해제 시, 학년 전체가 자습인 교시에는 교실 감독을 넣지 않고 복도 감독만 배치합니다.</li>
            </ul>

            <h2 style='color: #3498db; border-left: 5px solid #3498db; padding-left: 10px;'>2단계: 기초 공사 및 연동 (화면 왼쪽 위)</h2>
            <p>데이터가 입력될 빈칸을 만드는 과정입니다. <b>선행 조건</b>을 꼭 확인하세요!</p>
            <ul>
                <li><b>학년별 반 개수:</b> 1, 2, 3학년의 실제 학급 수를 정확히 입력하세요.</li>
                <li><b>일차 및 최대 교시:</b> 시험 기간과 그날의 가장 마지막 교시를 셋팅합니다.</li>
                <li><b>⭐ 필수 버튼:</b> 셋팅 후 <b style='color: #4361ee;'>[과목 및 예외 입력칸 연동 생성하기]</b>를 반드시 클릭해야 아래쪽 과목 입력창과 예외 명단 창이 활성화됩니다. (반 개수를 수정하고 다시 눌러도 기존 데이터는 보존됩니다!)</li>
            </ul>

            <h2 style='color: #27ae60; border-left: 5px solid #27ae60; padding-left: 10px;'>3단계: 교사 명단 셋팅 (화면 오른쪽 위)</h2>
            <p>AI가 감독관을 선발하는 핵심 기준입니다. 엑셀을 불러오거나 직접 추가할 때 다음 사항을 주의하세요.</p>
            <ul>
                <li style='margin-bottom: 10px;'><b>🚨 담임/부장 인식:</b> 담임 칸에 <code>3-1</code>처럼 학급이 적혀있어야 하며, 부장님은 반드시 <b><code>3-부장</code></b>이라고 정확히 적어야 제외 옵션이 적용됩니다. 담임은 본인 반에 감독이 배정되지 않습니다.</li>
                
                <li style='list-style-type: none;'><b>📌 교사 구분 규칙:</b>
                    <ul style='margin-top: 5px;'>
                        <li><b>일반:</b> 목표 시수 내에서 균등하게 배정됩니다.</li>
                        <li><b>고사담당:</b> 1교시 배정 제외 및 본인 시험 과목 시간을 AI가 알아서 피합니다.</li>
                        <li><b>원로:</b> 복도/자습 감독에서 제외되며, 하루 배정 한도를 초절전으로 관리합니다.</li>
                        <li><b>제외:</b> 출산/연가자 등 명단에서 완벽하게 제외하고 싶을 때 사용합니다.</li>
                    </ul>
                </li>
            </ul>

            <h2 style='color: #8e44ad; border-left: 5px solid #8e44ad; padding-left: 10px;'>4단계: 과목 입력과 8반(특별실) 마법 (화면 왼쪽 아래)</h2>
            <ul>
                <li><b>일괄 입력:</b> 엑셀의 시간표를 복사(Ctrl+C)한 뒤 <b>[과목 일괄 붙여넣기]</b> 팝업에서 붙여넣으세요.</li>
                <li><b>🟡 자습 / 🔴 제외 버튼:</b> 각 과목 칸 안의 버튼으로 제어합니다. <b>제외(🔴)</b> 버튼이 눌린 반은 감독관이 절대 들어가지 않습니다.</li>
                <li><b>✨ 추가반 개설 (*):</b> 이동수업으로 인해 추가반이 필요한 경우 과목명 뒤에 <code>*</code>를 붙이면 추가반이 자동 개설됩니다. 괄호를 쓰면 장소명이 엑셀에 반영됩니다. (예: <code>수학*(음악실)</code>)</li>
            </ul>

            <h2 style='color: #e74c3c; border-left: 5px solid #e74c3c; padding-left: 10px;'>5단계: 결과 검토 및 무한 다시 돌리기</h2>
            <p>준비가 끝났다면 <b>[🚀 배정 시작!]</b>을 누르세요.</p>
            <ul>
                <li><b>미리보기 창:</b> 엑셀 출력 전 최종 점검 단계입니다. '개인별 시간표' 탭에서 시수가 공평한지 확인하세요.</li>
                <li><b>🔄 다시 돌리기:</b> 결과가 마음에 들지 않으면 <b>[마음에 안 듦! 다시 돌리기]</b>를 누르세요. AI가 즉시 새로운 100만 가지 경우의 수를 다시 계산합니다.</li>
                <li><b>💾 저장:</b> 완벽하다면 엑셀로 저장하여 마무리합니다.</li>
            </ul>
        </div>
        """
        
        label = QLabel(guide_text)
        label.setWordWrap(True)
        label.setStyleSheet("font-size: 13px; background-color: white; padding: 10px;")
        content_layout.addWidget(label)
        content_layout.addStretch()
        
        scroll.setWidget(content_widget)
        layout.addWidget(scroll)

        btn_close = QPushButton("가이드를 숙지했습니다. 닫기")
        btn_close.setStyleSheet("background-color: #2c3e50; color: white; padding: 12px; font-weight: bold; border-radius: 5px;")
        btn_close.clicked.connect(self.accept)
        layout.addWidget(btn_close)

# =====================================================================
# ★ 신규 추가: 엑셀과 100% 동일한 [개인별 시간표] 미리보기 팝업창
# =====================================================================
class PreviewDialog(QDialog):
    def __init__(self, df_schedule, df_personal, parent=None):
        super().__init__(parent)
        self.setWindowTitle("👀 배정 결과 최종 검토 (엑셀 출력 전)")
        
        # ★ 수정: 운영체제에 '무조건 최대화 상태로 열어라'고 강제하는 강력한 명령어입니다!
        self.setWindowState(Qt.WindowState.WindowMaximized)
        
        layout = QVBoxLayout(self)

        # 탭 시스템 도입 (1. 개인별 시간표 / 2. 전체 감독표)
        self.tabs = QTabWidget()
        layout.addWidget(self.tabs)

        # ---------------------------------------------------------
        # 탭 1. 개인별 시간표 (엑셀 서식 그대로!)
        # ---------------------------------------------------------
        personal_tab = QWidget()
        personal_layout = QVBoxLayout(personal_tab)
        personal_layout.setContentsMargins(0, 5, 0, 0)
        personal_layout.setSpacing(0)

        # [핵심] 상단 5줄 헤더 고정용 표
        self.p_header = QTableWidget()
        self.p_header.setColumnCount(len(df_personal.columns))
        self.p_header.setRowCount(5)
        self.p_header.setFixedHeight(220) # ★ 과목명이 잘리지 않게 5줄 높이 시원하게 고정!
        self.p_header.verticalHeader().setVisible(False)
        self.p_header.horizontalHeader().setVisible(False)
        self.p_header.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        
        # [핵심] 하단 선생님 명단 스크롤용 표
        self.p_body = QTableWidget()
        self.p_body.setColumnCount(len(df_personal.columns))
        self.p_body.setRowCount(len(df_personal) - 5)
        self.p_body.verticalHeader().setVisible(False)
        self.p_body.horizontalHeader().setVisible(False)

        # 데이터 채우기 및 엑셀 색상 동기화
        fill_header = QColor("#E2EFDA")  # 연녹색
        fill_study = QColor("#FFF2CC")   # 노란색
        fill_reserve = QColor("#FCE4EC") # 연분홍색
        fill_purple = QColor("#E8DAEF")  # ★ 신규: 파스텔 보라 (복도)
        fill_blue = QColor("#D6EAF8")    # ★ 신규: 파스텔 파랑 (본인 시험)

        # 1. 상단 5줄 헤더 데이터 및 서식 (병합은 엑셀 저장 로직 참고)
        for r in range(5):
            self.p_header.setRowHeight(r, 44) 
            for c in range(len(df_personal.columns)):
                val = str(df_personal.iloc[r, c]) if not pd.isna(df_personal.iloc[r, c]) else ""
                item = QTableWidgetItem(val)
                item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                item.setBackground(fill_header)
                if "자습" in val: item.setBackground(fill_study)
                item.setFlags(Qt.ItemFlag.ItemIsEnabled)
                self.p_header.setItem(r, c, item)

       # ==========================================
        # ★ 엑셀과 똑같이 미리보기 표도 [셀 병합] 처리!
        # ==========================================
        total_cols = len(df_personal.columns)
        self.p_header.setSpan(0, 0, 5, 1)
        self.p_header.setSpan(0, 1, 5, 1)
        self.p_header.setSpan(0, 2, 5, 1) # ★ 신규: 과목 열(3번째 칸) 병합 추가
        for c in range(total_cols - 5, total_cols):
            self.p_header.setSpan(0, c, 5, 1)
            
        start_col = 3 # ★ 수정: 과목 열이 생겨서 일차(날짜) 병합 검사는 3번 칸부터 시작!
        while start_col < total_cols - 5:
            val = str(df_personal.iloc[0, start_col])
            span = 1
            for next_col in range(start_col + 1, total_cols - 5):
                if str(df_personal.iloc[0, next_col]) == val: span += 1
                else: break
            if span > 1: self.p_header.setSpan(0, start_col, 1, span)
            start_col += span

        # ==========================================
        # ★ 실수로 날아갔던 명단 채우기 및 파스텔 색칠 뼈대 복구!
        # ==========================================
        for r in range(len(df_personal) - 5):
            is_reserve = str(df_personal.iloc[r+5, 1]) == "예비"
            for c in range(len(df_personal.columns)):
                val = str(df_personal.iloc[r+5, c]) if not pd.isna(df_personal.iloc[r+5, c]) else ""
                if val == "nan": val = ""
                
                # ★ 마커 숨기기: 화면에는 글씨 없이 깔끔하게!
                display_val = val
                if val == "본인시험_마커": display_val = ""
                
                item = QTableWidgetItem(display_val)
                item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                item.setFlags(Qt.ItemFlag.ItemIsEnabled)
                
                if is_reserve: 
                    item.setBackground(fill_reserve)
                else:
                    if val == "본인시험_마커":
                        item.setBackground(fill_blue)
                    elif "복도" in val:
                        item.setBackground(fill_purple)
                    elif "-" in val:
                        # 미리보기 창에서도 자습반을 똑똑하게 추적해서 노란색 칠하기!
                        try:
                            grade_str, class_str = val.split("-")
                            grade = int(''.join(filter(str.isdigit, grade_str)))
                            class_num = int(''.join(filter(str.isdigit, class_str)))
                            header_val = str(df_personal.iloc[grade+1, c])
                            if "자습" in header_val:
                                if self.parent() and hasattr(self.parent(), 'parse_grade_subject'):
                                    parsed = self.parent().parse_grade_subject(header_val)
                                    if parsed['examName'] == '자습' or class_num in parsed['studyClasses']:
                                        item.setBackground(fill_study)
                        except: pass
                        
                self.p_body.setItem(r, c, item)

        # 두 표의 컬럼 너비 동기화 및 스크롤 연동
        total_cols = len(df_personal.columns)
        for c in range(total_cols):
            if c == 0: w = 40        # 연번
            elif c == 1: w = 75      # 이름
            elif c == 2: w = 105     # 과목
            elif c >= total_cols - 5: w = 45  # ★ 신규: 끝에 있는 5개 통계 열 너비를 45로 쫙 줄임!
            else: w = 120            # 시간표 칸
            
            self.p_header.setColumnWidth(c, w)
            self.p_body.setColumnWidth(c, w)

        self.p_body.horizontalScrollBar().valueChanged.connect(self.p_header.horizontalScrollBar().setValue)

        personal_layout.addWidget(self.p_header)
        personal_layout.addWidget(self.p_body)
        self.tabs.addTab(personal_tab, "1. 개인별 시간표 (최종 검토)")

        # 탭 2. 전체 감독표 (기존 방식)
        self.schedule_table = QTableWidget()
        self.schedule_table.setColumnCount(len(df_schedule.columns))
        self.schedule_table.setHorizontalHeaderLabels(df_schedule.columns)
        self.schedule_table.setRowCount(len(df_schedule))
        for r in range(len(df_schedule)):
            for c in range(len(df_schedule.columns)):
                val = str(df_schedule.iloc[r, c])
                item = QTableWidgetItem(val if val != "nan" else "")
                item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                self.schedule_table.setItem(r, c, item)
        self.tabs.addTab(self.schedule_table, "2. 전체 감독표")

        # 하단 버튼
        btn_layout = QHBoxLayout()
        self.btn_save = QPushButton("💾 이대로 엑셀 저장하기")
        self.btn_save.setStyleSheet("background-color: #3498db; color: white; font-weight: bold; padding: 12px; font-size: 14px;")
        self.btn_rerun = QPushButton("🔄 마음에 안 듦! 다시 돌리기")
        self.btn_rerun.setStyleSheet("background-color: #e67e22; color: white; font-weight: bold; padding: 12px; font-size: 14px;")
        
        # ★ 누락되었던 취소 버튼 생성!
        self.btn_cancel = QPushButton("❌ 취소")
        self.btn_cancel.setStyleSheet("padding: 12px; font-weight: bold;")
        
        btn_layout.addStretch()
        btn_layout.addWidget(self.btn_cancel)
        btn_layout.addWidget(self.btn_rerun)
        btn_layout.addWidget(self.btn_save)
        layout.addLayout(btn_layout)

        self.btn_save.clicked.connect(lambda: self.done(1))
        self.btn_rerun.clicked.connect(lambda: self.done(2))
        self.btn_cancel.clicked.connect(self.reject)          # 0번 신호 = 그냥 끄기

class ExamScheduler(QMainWindow):
    def __init__(self):
        super().__init__()
        self.initUI()

    def initUI(self):
        self.setWindowTitle('스마트 시험 감독 배정 프로그램(파이썬제작) ⓒ 2026. Designed & Coded by 이용휘. All rights reserved.')
        self.setGeometry(100, 100, 1300, 800) # 가로를 1300으로 조금 더 넓혔습니다!

        main_widget = QWidget()
        self.setCentralWidget(main_widget)
        main_layout = QVBoxLayout()
        main_widget.setLayout(main_layout)

        # ---------------- 상단 헤더 영역 ----------------
        header_layout = QHBoxLayout()
        title_label = QLabel('📊 스마트 시험 감독 배정 프로그램 by 이용휘')
        font = title_label.font()
        font.setPointSize(16)
        font.setBold(True)
        title_label.setFont(font)

        btn_save = QPushButton('💾 DATA SAVE')
        btn_save.setStyleSheet("background-color: #34495e; color: white; font-weight: bold; padding: 10px; border-radius: 5px;")
        btn_save.clicked.connect(self.save_all_settings) # 누르면 저장 함수 실행!

        btn_load = QPushButton('📂 DATA LOAD')
        btn_load.setStyleSheet("background-color: #2c3e50; color: white; font-weight: bold; padding: 10px; border-radius: 5px;")
        btn_load.clicked.connect(self.load_all_settings) # 누르면 불러오기 함수 실행!

        btn_run = QPushButton('🚀 배정 시작!')
        btn_run.setStyleSheet("background-color: #27ae60; color: white; font-weight: bold; padding: 10px; border-radius: 5px;")
        btn_run.clicked.connect(self.run_ai_assignment) # ★ 버튼을 누르면 AI 엔진 가동!

        # --- 상단 헤더: 회차 선택 UI 추가 ---
        header_layout.addWidget(title_label)
        header_layout.addStretch()

        term_label = QLabel('📌 배정 회차:')
        term_label.setStyleSheet("font-weight: bold; color: #2c3e50;")
        self.term_combo = QComboBox()
        self.term_combo.addItems(['1차 고사', '2차 고사', '3차 고사', '4차 고사'])
        self.term_combo.setStyleSheet("font-weight: bold; padding: 5px; color: #e67e22; background: white;")
        
        header_layout.addWidget(term_label)
        header_layout.addWidget(self.term_combo)
        
        # ==========================================
        # ★ 신규 추가: 4차 고사 전용 3학년 제외 옵션 체크박스
        # ==========================================
        self.check_exclude_3rd = QCheckBox("3학년 담임/부장 배정 제외")
        self.check_exclude_3rd.setStyleSheet("font-weight: bold; color: #c0392b;")
        self.check_exclude_3rd.setChecked(True)
        self.check_exclude_3rd.setVisible(False)
        
        # ★ 신규 추가: 전체 자습 시 교실 감독 여부 체크박스
        self.check_assign_studyhall = QCheckBox("전체 자습 시 교실 감독 배정")
        self.check_assign_studyhall.setStyleSheet("font-weight: bold; color: #2980b9;")
        self.check_assign_studyhall.setChecked(False) 
       
        # 콤보박스 글자가 '4차 고사'일 때만 체크박스가 짠! 하고 나타나는 마법
        self.term_combo.currentTextChanged.connect(lambda text: self.check_exclude_3rd.setVisible(text == "4차 고사"))
        
        header_layout.addWidget(self.check_exclude_3rd)
        header_layout.addWidget(self.check_assign_studyhall)
        header_layout.addStretch()

        # ★ 신규 추가: 설명서 버튼 생성 및 띄우기 연결
        btn_help = QPushButton('❓ 설명서')
        btn_help.setStyleSheet("background-color: #9b59b6; color: white; font-weight: bold; padding: 10px; border-radius: 5px;")
        btn_help.clicked.connect(lambda: HelpDialog(self).exec())
        header_layout.addWidget(btn_help)

        header_layout.addWidget(btn_save) 
        header_layout.addWidget(btn_load) 
        header_layout.addWidget(btn_run)
        main_layout.addLayout(header_layout)

        # ---------------- 본문 영역 (3단 컬럼) ----------------
        content_layout = QHBoxLayout()

        # ★ [컬럼 1] 시험일 셋팅 & 과목표
        col1_widget = QWidget()
        col1_layout = QVBoxLayout()
        col1_widget.setLayout(col1_layout)

        col1_header = QHBoxLayout()
        col1_title = QLabel('📅 1. 시험일 및 교시 셋팅')
        col1_title.setStyleSheet("font-weight: bold; font-size: 14px; color: #2c3e50;")
        btn_add_day = QPushButton('➕ 일차 추가')
        btn_add_day.clicked.connect(self.add_day_row)
        col1_header.addWidget(col1_title); col1_header.addStretch(); col1_header.addWidget(btn_add_day)

        max_class_layout = QHBoxLayout()
        max_class_layout.addWidget(QLabel("1학년:"))
        self.spin_m1 = QSpinBox(); self.spin_m1.setValue(7); self.spin_m1.setMinimum(1)
        max_class_layout.addWidget(self.spin_m1)
        max_class_layout.addWidget(QLabel("2학년:"))
        self.spin_m2 = QSpinBox(); self.spin_m2.setValue(7); self.spin_m2.setMinimum(1)
        max_class_layout.addWidget(self.spin_m2)
        max_class_layout.addWidget(QLabel("3학년:"))
        self.spin_m3 = QSpinBox(); self.spin_m3.setValue(7); self.spin_m3.setMinimum(1)
        max_class_layout.addWidget(self.spin_m3)
        max_class_layout.addStretch()

        self.day_table = QTableWidget()
        self.day_table.setColumnCount(4)
        self.day_table.setHorizontalHeaderLabels(['일차', '시험일(예:4/27)', '최대교시', '삭제'])
        self.day_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.day_table.setFixedHeight(180) 

        btn_generate = QPushButton('⬇️ 과목 및 예외 입력칸 연동 생성하기')
        btn_generate.setStyleSheet("background-color: #4361ee; color: white; padding: 10px; font-weight: bold; border-radius: 4px; margin-top: 5px;")
        btn_generate.clicked.connect(self.generate_timetables)

        # ==========================================
        # ★ 신규: 과목표 전체를 묶어줄 '컨테이너(상자)'
        # ==========================================
        self.subject_container = QWidget()
        subj_layout = QVBoxLayout(self.subject_container)
        subj_layout.setContentsMargins(0, 0, 0, 0)

        subj_header = QHBoxLayout()
        self.subject_label = QLabel('📝 2. 일차별 시험 과목')
        self.subject_label.setStyleSheet("font-weight: bold; font-size: 14px; color: #4361ee; margin-top: 10px;")
        
        # ★ 신규 추가: 선생님의 기획! 제목 옆 친절한 범례
        legend_label = QLabel('( 🟡 자습반  |  🔴 교실감독 제외 )')
        legend_label.setStyleSheet("font-size: 12px; color: #7f8c8d; font-weight: bold; margin-top: 10px;")
        
        self.btn_batch_input = QPushButton('⌨️ 과목 일괄 붙여넣기')
        self.btn_batch_input.setStyleSheet("background-color: #3498db; color: white; font-weight: bold; padding: 4px; border-radius: 4px; margin-top: 10px;")
        subj_header.addWidget(self.subject_label)
        subj_header.addWidget(legend_label) # 범례 끼워넣기!
        subj_header.addStretch()
        subj_header.addWidget(self.btn_batch_input)
        self.btn_batch_input.setStyleSheet("background-color: #3498db; color: white; font-weight: bold; padding: 4px; border-radius: 4px; margin-top: 10px;")
        self.btn_batch_input.clicked.connect(self.open_batch_input)
        subj_header.addWidget(self.subject_label); subj_header.addStretch(); subj_header.addWidget(self.btn_batch_input)

        self.subject_table = QTableWidget()
        self.subject_table.setColumnCount(6)
        self.subject_table.setHorizontalHeaderLabels(['일차', '시험일', '교시', '1학년', '2학년', '3학년'])
        self.subject_table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.Stretch)
        self.subject_table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.Stretch)
        self.subject_table.horizontalHeader().setSectionResizeMode(5, QHeaderView.ResizeMode.Stretch)

        subj_layout.addLayout(subj_header)
        subj_layout.addWidget(self.subject_table, 1)

        self.subject_container.setVisible(False) # 처음엔 상자를 통째로 숨김

        col1_layout.addLayout(col1_header)
        col1_layout.addLayout(max_class_layout)
        col1_layout.addWidget(self.day_table)
        col1_layout.addWidget(btn_generate)
        col1_layout.addWidget(self.subject_container, 1) 
        col1_layout.addStretch() # ★ 상자가 숨겨져 있을 때 모든 요소를 위로 착 밀어주는 스프링!

        # [컬럼 2] 교사 명단 표 & 엑셀 불러오기 세팅
        col2_widget = QWidget()
        col2_layout = QVBoxLayout()
        col2_widget.setLayout(col2_layout)

        col2_header = QHBoxLayout()
        col2_title = QLabel('👨‍🏫 3. 전체 교사 명단')
        col2_title.setStyleSheet("font-weight: bold; font-size: 14px; color: #2c3e50;")
        
        # ★ 추가: ➕ 추가 버튼 달기
        btn_add_teacher = QPushButton('➕ 추가')
        btn_add_teacher.clicked.connect(self.add_teacher_row)

        btn_load_excel = QPushButton('📂 엑셀 파일 불러오기')
        btn_load_excel.setStyleSheet("background-color: #f39c12; color: white; padding: 5px; font-weight: bold; border-radius: 4px;")
        btn_load_excel.clicked.connect(self.load_excel_data)
        
        # 상단에 추가 버튼과 엑셀 버튼 나란히 배치
        col2_header.addWidget(col2_title); col2_header.addStretch(); col2_header.addWidget(btn_add_teacher); col2_header.addWidget(btn_load_excel)

        # 1. 표 생성 (열 개수 7개로 증가, 삭제 열 추가!)
        self.teacher_table = QTableWidget()
        self.teacher_table.setColumnCount(7)
        self.teacher_table.setHorizontalHeaderLabels(['연번', '이름', '과목', '담임', '교사구분', '목표시수', '삭제'])

        # 2. 너비 최적화 설정
        self.teacher_table.setColumnWidth(0, 40)  # 연번
        self.teacher_table.setColumnWidth(1, 60)  # 이름
        self.teacher_table.setColumnWidth(5, 60)  # 목표시수
        self.teacher_table.setColumnWidth(6, 40)  # ★ 추가: 삭제 열 (좁게)

        # 3. '과목' 열이 남은 공간 차지
        self.teacher_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        # 나머지 열(담임, 교사구분 등)은 내용에 맞춰 자동으로 조절되게 두거나 기본값을 유지합니다.

        col2_layout.addLayout(col2_header)
        col2_layout.addWidget(self.teacher_table)

        # ★ [컬럼 3] 특수실 및 요일/교시별 예외 감독자
        col3_widget = QWidget()
        col3_layout = QVBoxLayout()
        col3_widget.setLayout(col3_layout)

        col3_header1 = QHBoxLayout()
        col3_title1 = QLabel('🏠 4. 특수실 예외사항')
        col3_title1.setStyleSheet("font-weight: bold; font-size: 14px; color: #d35400;")
        btn_add_special = QPushButton('➕ 추가')
        btn_add_special.clicked.connect(self.add_special_row)
        col3_header1.addWidget(col3_title1); col3_header1.addStretch(); col3_header1.addWidget(btn_add_special)

        self.special_table = QTableWidget()
        self.special_table.setColumnCount(4)
        self.special_table.setHorizontalHeaderLabels(['명칭', '지정자', '시수', '삭제'])
        self.special_table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        self.special_table.setFixedHeight(120)

        # ==========================================
        # ★ 신규: 예외표 전체를 묶어줄 '컨테이너(상자)'
        # ==========================================
        self.exception_container = QWidget()
        exc_layout = QVBoxLayout(self.exception_container)
        exc_layout.setContentsMargins(0, 0, 0, 0)

        col3_header2 = QHBoxLayout()
        self.exception_label = QLabel('⚠️ 5. 요일/교시별 예외 감독자')
        self.exception_label.setStyleSheet("font-weight: bold; font-size: 14px; color: #e74c3c; margin-top: 10px;")
        # 옛날 전체 추가 버튼은 삭제하고 라벨만 깔끔하게 남깁니다.
        col3_header2.addWidget(self.exception_label); col3_header2.addStretch()

        # ★ 1. HTML 웹 버전처럼 일차별 표를 차곡차곡 담을 '스크롤 영역' 생성
        self.exc_scroll = QScrollArea()
        self.exc_scroll.setWidgetResizable(True)
        self.exc_scroll.setStyleSheet("QScrollArea { border: none; background-color: transparent; }")
        self.exc_scroll_content = QWidget()
        self.exc_scroll_layout = QVBoxLayout(self.exc_scroll_content)
        self.exc_scroll_layout.setAlignment(Qt.AlignmentFlag.AlignTop)
        self.exc_scroll_layout.setSpacing(10)
        self.exc_scroll.setWidget(self.exc_scroll_content)

        exc_layout.addLayout(col3_header2)
        exc_layout.addWidget(self.exc_scroll, 1)
        self.exception_tables = [] # 분리된 표들을 담을 리스트
        
        self.exception_container.setVisible(False) # 상자를 통째로 숨김

        col3_layout.addLayout(col3_header1)
        col3_layout.addWidget(self.special_table)
        col3_layout.addWidget(self.exception_container, 1)
        col3_layout.addStretch() # ★ 스프링!

        # 레이아웃 비율 맞춰서 넣기
        content_layout.addWidget(col1_widget, 40)
        content_layout.addWidget(col2_widget, 40)
        content_layout.addWidget(col3_widget, 20) 

        main_layout.addLayout(content_layout)
        
        # ==========================================
        # ★ 전체 표(Table) 공통 디자인 일괄 적용
        # ==========================================
        tables = [self.day_table, self.subject_table, self.teacher_table, self.special_table]
        for table in tables:
            # 1. 속 시원하게! 모든 표의 맨 왼쪽 행 번호를 싹 다 숨겨버리기
            table.verticalHeader().setVisible(False)
            
            table.setStyleSheet("""
                QTableWidget {
                    gridline-color: #bdc3c7; 
                    border: 1px solid #bdc3c7;
                }
                QHeaderView::section {
                    background-color: #f8f9fa; 
                    border: 1px solid #bdc3c7;
                    font-weight: bold;
                }
            """)

        # ==========================================
        # ★ 신규 추가: 프로그램 저작권 표시
        # ==========================================
        copyright_label = QLabel('ⓒ 2026. Designed & Coded by 이용휘. All rights reserved.')
        copyright_label.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        copyright_label.setStyleSheet("color: #95a5a6; font-size: 11px; font-weight: bold; margin-top: 5px; margin-right: 10px;")
        main_layout.addWidget(copyright_label)

        # 시작할 때 기본 세팅 (예외는 연동 버튼 누를 때 생성됨)
        self.add_day_row()
        self.add_special_row()

    # ---------------- 각종 기능 함수들 ----------------

    # ★ 핵심 기능: 연동 생성하기 버튼을 눌렀을 때 실행되는 함수!
    def generate_timetables(self):
        day_count = self.day_table.rowCount()
        if day_count == 0:
            QMessageBox.warning(self, "경고", "최소 1일차 이상의 셋팅이 필요합니다.")
            return

        # ==========================================
        # ★ 0. 기존 과목 데이터 절대 사수 (백업 로직)
        # ==========================================
        backup_data = {}
        if self.subject_table.rowCount() > 0:
            old_data = self.get_table_data(self.subject_table)
            for row_data in old_data:
                if len(row_data) >= 6:
                    day_key = f"{row_data[0]}_{row_data[2]}" 
                    backup_data[day_key] = {
                        3: row_data[3], 
                        4: row_data[4], 
                        5: row_data[5]  
                    }

        # ==========================================
        # ★ 신규 추가: 기존 예외 명단 절대 사수 (백업 로직)
        # ==========================================
        backup_exceptions = {}
        if hasattr(self, 'exception_tables'):
            for exc in self.exception_tables:
                day_text = exc['day_text']
                if day_text not in backup_exceptions:
                    backup_exceptions[day_text] = {}
                
                table = exc['table']
                for r in range(table.rowCount()):
                    p = table.item(r, 0).text() if table.item(r, 0) else ""
                    n = table.item(r, 1).text() if table.item(r, 1) else ""
                    s = table.item(r, 2).text() if table.item(r, 2) else ""
                    
                    if p not in backup_exceptions[day_text]:
                        backup_exceptions[day_text][p] = []
                    
                    # 이름이나 사유가 하나라도 적혀있으면 소중하게 백업!
                    if n.strip() or s.strip():
                        backup_exceptions[day_text][p].append({'name': n, 'reason': s})

        # 1. 학년별 최대 반 숫자 가져오기
        max_c1 = self.spin_m1.value()
        max_c2 = self.spin_m2.value()
        max_c3 = self.spin_m3.value()

        # 2. 총 만들어야 할 줄 수 계산하기 (일차별 교시 수의 합)
        total_rows = 0
        schedule_data = [] 
        
        for row in range(day_count):
            day_text = self.day_table.item(row, 0).text()
            date_text = self.day_table.item(row, 1).text() if self.day_table.item(row, 1) else "-"
            
            period_item = self.day_table.item(row, 2)
            try: max_p = int(period_item.text()) if period_item and period_item.text() else 1
            except: max_p = 1

            total_rows += max_p
            for p in range(1, max_p + 1):
                schedule_data.append([day_text, date_text, str(p)])

        # 3. 과목 표 생성 및 셋팅 시작!
        self.subject_table.setRowCount(total_rows)
        self.subject_table.verticalHeader().setDefaultSectionSize(120)
        
        # 앞쪽 열 너비를 줄이고 과목 칸 확보
        self.subject_table.setColumnWidth(0, 50) # 일차
        self.subject_table.setColumnWidth(1, 55) # 시험일
        self.subject_table.setColumnWidth(2, 40) # 교시

        # 일차별 구분을 위한 파스텔 색상 리스트
        day_colors = [QColor("#e7f5ff"), QColor("#ebfbee"), QColor("#fff9db"), QColor("#f3f0ff")]

        for i, data in enumerate(schedule_data):
            day_text = data[0]
            period_text = data[2]
            
            # ★ 핵심 누락 코드 복구: 각 줄마다 고유한 열쇠를 다시 만들어줘야 제자리에 들어갑니다!
            day_key = f"{day_text}_{period_text}" 
            
            # 일차 숫자(1, 2, 3...)에 따라 배경색 결정
            try:
                day_num = int(''.join(filter(str.isdigit, day_text)))
                bg_color = day_colors[(day_num - 1) % len(day_colors)]
            except:
                bg_color = QColor(255, 255, 255)

            for j in range(3):
                item = QTableWidgetItem(data[j])
                item.setFlags(item.flags() & ~Qt.ItemFlag.ItemIsEditable)
                item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                item.setBackground(bg_color) # 일차별 배경색 적용
                self.subject_table.setItem(i, j, item)

            # 1, 2, 3학년 빈 위젯 생성
            w1 = SubjectCellWidget(max_c1)
            w2 = SubjectCellWidget(max_c2)
            w3 = SubjectCellWidget(max_c3)

            # ==========================================
            # ★ 백업 데이터가 있으면 그 자리에 쏙쏙 집어넣기!
            # ==========================================
            if day_key in backup_data:
                saved_row = backup_data[day_key]
                for col_idx, widget in zip([3, 4, 5], [w1, w2, w3]):
                    val = saved_row.get(col_idx)
                    if isinstance(val, dict):
                        widget.subj_input.setText(val.get('text', ''))
                        # 신규 데이터 복구
                        for btn in widget.study_btns:
                            if btn.text() in val.get('study_btns', []): btn.setChecked(True)
                        for btn in widget.exclude_btns:
                            if btn.text() in val.get('exclude_btns', []): btn.setChecked(True)
                        # 혹시 모를 옛날 데이터(active_btns) 호환 유지
                        for btn in widget.study_btns:
                            if btn.text() in val.get('active_btns', []): btn.setChecked(True)

            self.subject_table.setCellWidget(i, 3, w1)
            self.subject_table.setCellWidget(i, 4, w2)
            self.subject_table.setCellWidget(i, 5, w3)
            
            # ★ 핵심: PyQt가 마음대로 높이를 줄이지 못하도록 각 줄의 높이를 85로 강력하게 못 박음!
            self.subject_table.setRowHeight(i, 120)

        # ★ 숨겨놨던 상자(컨테이너) 2개를 통째로 켜기!
        self.subject_container.setVisible(True)
        self.exception_container.setVisible(True)
        
        # ==========================================
        # ★ HTML 웹 버전처럼 일차별로 예외 표 따로따로 그려주기!
        # ==========================================
        # 1. 기존 표 싹 지우기 (초기화)
        for i in reversed(range(self.exc_scroll_layout.count())): 
            widget = self.exc_scroll_layout.itemAt(i).widget()
            if widget: widget.deleteLater()
        self.exception_tables.clear()

        # 2. 일차별로 데이터 그룹 묶기
        day_groups = {}
        for data in schedule_data:
            day_text = data[0]
            if day_text not in day_groups:
                day_groups[day_text] = []
            day_groups[day_text].append(data[2]) # 교시 담기

        # 3. 그룹별로 표 생성 및 백업 데이터 복구!
        for day_text, periods in day_groups.items():
            header_lay = QHBoxLayout()
            title_lbl = QLabel(f"▶ {day_text}")
            title_lbl.setStyleSheet("font-weight: bold; font-size: 13px; color: #2c3e50;")
            
            btn_add = QPushButton('➕ 추가')
            btn_add.setStyleSheet("background-color: #ecf0f1; border: 1px solid #bdc3c7; border-radius: 3px; padding: 2px 5px;")
            header_lay.addWidget(title_lbl); header_lay.addStretch(); header_lay.addWidget(btn_add)

            table = QTableWidget()
            table.setColumnCount(4)
            table.setHorizontalHeaderLabels(['교시', '이름', '사유', '삭제'])
            table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
            table.verticalHeader().setVisible(False)
            table.setStyleSheet("QTableWidget { gridline-color: #bdc3c7; border: 1px solid #bdc3c7; background-color: white; }")
            
            # ★ 신규 복구 로직: 백업 데이터를 확인하며 줄을 하나씩 추가하는 방식으로 변경
            day_backup = backup_exceptions.get(day_text, {})
            row_idx = 0
            
            for p in periods:
                p_str = str(p)
                backed_up_rows = day_backup.get(p_str, [])
                
                # 백업된 데이터가 있으면 그 개수만큼 모두 살려내기!
                if backed_up_rows:
                    for b_data in backed_up_rows:
                        table.insertRow(row_idx)
                        item_p = QTableWidgetItem(p_str); item_p.setTextAlignment(Qt.AlignmentFlag.AlignCenter); item_p.setBackground(Qt.GlobalColor.lightGray)
                        table.setItem(row_idx, 0, item_p)
                        item_n = QTableWidgetItem(b_data['name']); item_n.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                        table.setItem(row_idx, 1, item_n)
                        item_s = QTableWidgetItem(b_data['reason']); item_s.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                        table.setItem(row_idx, 2, item_s)
                        
                        btn_del = QPushButton('✕'); btn_del.setStyleSheet("color: #e74c3c; border: none; font-weight: bold;")
                        btn_del.clicked.connect(lambda _, t=table, b=btn_del: self.delete_specific_row(t, b))
                        table.setCellWidget(row_idx, 3, btn_del)
                        row_idx += 1
                else:
                    # 백업 데이터가 없으면 예전처럼 깔끔한 빈칸 1줄 생성
                    table.insertRow(row_idx)
                    item_p = QTableWidgetItem(p_str); item_p.setTextAlignment(Qt.AlignmentFlag.AlignCenter); item_p.setBackground(Qt.GlobalColor.lightGray)
                    table.setItem(row_idx, 0, item_p)
                    item_n = QTableWidgetItem(""); item_n.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                    table.setItem(row_idx, 1, item_n)
                    item_s = QTableWidgetItem(""); item_s.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                    table.setItem(row_idx, 2, item_s)
                    
                    btn_del = QPushButton('✕'); btn_del.setStyleSheet("color: #e74c3c; border: none; font-weight: bold;")
                    btn_del.clicked.connect(lambda _, t=table, b=btn_del: self.delete_specific_row(t, b))
                    table.setCellWidget(row_idx, 3, btn_del)
                    row_idx += 1

            table.setFixedHeight(30 + (table.rowCount() * 30) + 2)
            btn_add.clicked.connect(lambda _, t=table: self.add_specific_row(t))

            group_widget = QWidget()
            group_layout = QVBoxLayout(group_widget)
            group_layout.setContentsMargins(0, 0, 0, 10)
            group_layout.addLayout(header_lay)
            group_layout.addWidget(table)
            
            self.exc_scroll_layout.addWidget(group_widget)
            self.exception_tables.append({'day_text': day_text, 'table': table})

        QMessageBox.information(self, "성공", "과목 및 예외 셋팅이 연동되었습니다!")

    # --- 기존에 있던 행 추가/삭제 기능들 ---
    def add_day_row(self):
        row_idx = self.day_table.rowCount()
        self.day_table.insertRow(row_idx)
        day_item = QTableWidgetItem(f"{row_idx + 1}일차")
        day_item.setFlags(day_item.flags() & ~Qt.ItemFlag.ItemIsEditable) 
        day_item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
        self.day_table.setItem(row_idx, 0, day_item)
        
        # 시험일 입력칸을 가운데 정렬로 생성
        date_item = QTableWidgetItem("")
        date_item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
        self.day_table.setItem(row_idx, 1, date_item)
        
        period_item = QTableWidgetItem("3")
        period_item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
        self.day_table.setItem(row_idx, 2, period_item)
        
        btn_del = QPushButton('✕')
        btn_del.setStyleSheet("color: #e74c3c; border: none; font-weight: bold;")
        btn_del.clicked.connect(lambda _, b=btn_del: self.delete_row(self.day_table, b, update_labels=True))
        self.day_table.setCellWidget(row_idx, 3, btn_del)

    def add_special_row(self):
        # (기존 로직 유지)
        row_idx = self.special_table.rowCount()
        self.special_table.insertRow(row_idx)
        for col in range(3):
            item = QTableWidgetItem(""); item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
            self.special_table.setItem(row_idx, col, item)
        btn_del = QPushButton('✕')
        btn_del.setStyleSheet("color: #e74c3c; border: none; font-weight: bold;")
        btn_del.clicked.connect(lambda _, b=btn_del: self.delete_row(self.special_table, b))
        self.special_table.setCellWidget(row_idx, 3, btn_del)

    # =====================================================================
    # ★ 신규 추가: 교사 명단 1명 수동 추가 기능
    # =====================================================================
    def add_teacher_row(self):
        row_idx = self.teacher_table.rowCount()
        self.teacher_table.insertRow(row_idx)
        
        # 1. 연번 자동 입력 및 수정 잠금
        item_num = QTableWidgetItem(str(row_idx + 1))
        item_num.setFlags(item_num.flags() & ~Qt.ItemFlag.ItemIsEditable) 
        item_num.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
        self.teacher_table.setItem(row_idx, 0, item_num)
        
        # 2. 나머지 정보 칸 빈칸으로 생성
        for col in range(1, 6):
            item = QTableWidgetItem("")
            item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
            self.teacher_table.setItem(row_idx, col, item)
            
        # 3. 우측 끝에 삭제(X) 버튼 생성
        btn_del = QPushButton('✕')
        btn_del.setStyleSheet("color: #e74c3c; border: none; font-weight: bold;")
        btn_del.clicked.connect(lambda _, b=btn_del: self.delete_row(self.teacher_table, b, update_labels=True))
        self.teacher_table.setCellWidget(row_idx, 6, btn_del)

    # 통합 삭제 함수 (일차와 연번을 똑똑하게 구분하도록 진화)
    def delete_row(self, table, button, update_labels=False):
        for row in range(table.rowCount()):
            last_col = table.columnCount() - 1 
            if table.cellWidget(row, last_col) == button:
                table.removeRow(row)
                break
        if update_labels:
            for r in range(table.rowCount()):
                if table == self.day_table:
                    table.item(r, 0).setText(f"{r + 1}일차")
                elif table == self.teacher_table:
                    table.item(r, 0).setText(str(r + 1)) # 삭제 시 연번 자동 당겨오기

    def load_excel_data(self):
        file_path, _ = QFileDialog.getOpenFileName(self, '교사 명단 엑셀 선택', '', 'Excel Files (*.xlsx *.xls)')
        if file_path:
            try:
                df = pd.read_excel(file_path).fillna("")
                self.teacher_table.setRowCount(len(df))
                for row_idx in range(len(df)):
                    for col_idx in range(len(df.columns)):
                        cell_value = str(df.iloc[row_idx, col_idx])
                        item = QTableWidgetItem(cell_value)
                        item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                        self.teacher_table.setItem(row_idx, col_idx, item)
                    
                    # ★ 추가: 엑셀에서 불러온 줄의 맨 끝(6번 열)에도 삭제 버튼 부착!
                    btn_del = QPushButton('✕')
                    btn_del.setStyleSheet("color: #e74c3c; border: none; font-weight: bold;")
                    btn_del.clicked.connect(lambda _, b=btn_del: self.delete_row(self.teacher_table, b, update_labels=True))
                    self.teacher_table.setCellWidget(row_idx, 6, btn_del)

                QMessageBox.information(self, "성공", f"총 {len(df)}명의 교사 명단을 성공적으로 불러왔습니다!")
            except Exception as e:
                QMessageBox.critical(self, "오류", f"엑셀 파일을 읽는 중 문제가 발생했습니다.\n\n{e}")

    # =====================================================================
    # ★ 신규 추가: 화면 전체 데이터를 JSON 파일로 저장하고 불러오는 기능
    # =====================================================================
    def save_all_settings(self):
        # 1. 화면에 있는 모든 표와 숫자 데이터를 긁어모아서 사전(Dict) 형태로 정리
        data = {
            'max_classes': [self.spin_m1.value(), self.spin_m2.value(), self.spin_m3.value()],
            'day_table': self.get_table_data(self.day_table),
            'teacher_table': self.get_table_data(self.teacher_table),
            'special_table': self.get_table_data(self.special_table),
            'subject_table': self.get_table_data(self.subject_table) 
        }
        # 일차별 예외표 저장 방식 업데이트
        exc_data = []
        if hasattr(self, 'exception_tables'):
            for exc in self.exception_tables:
                t_data = []
                for r in range(exc['table'].rowCount()):
                    p = exc['table'].item(r, 0).text() if exc['table'].item(r, 0) else ""
                    n = exc['table'].item(r, 1).text() if exc['table'].item(r, 1) else ""
                    s = exc['table'].item(r, 2).text() if exc['table'].item(r, 2) else ""
                    t_data.append([p, n, s])
                exc_data.append({'day_text': exc['day_text'], 'rows': t_data})
        data['exception_tables_data'] = exc_data
        
        # 2. 어디에 저장할지 파일 탐색기 열기
        file_path, _ = QFileDialog.getSaveFileName(self, '전체 셋팅 저장', '부광고_배정셋팅_백업.json', 'JSON Files (*.json)')
        
        if file_path:
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=4)
            QMessageBox.information(self, "저장 완료", "모든 셋팅 데이터가 안전하게 파일로 저장되었습니다!")

    def load_all_settings(self):
        file_path, _ = QFileDialog.getOpenFileName(self, '전체 셋팅 불러오기', '', 'JSON Files (*.json)')
        if file_path:
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)

                # 1. 기초 설정 복구 (반 개수 등)
                if 'max_classes' in data:
                    self.spin_m1.setValue(data['max_classes'][0])
                    self.spin_m2.setValue(data['max_classes'][1])
                    self.spin_m3.setValue(data['max_classes'][2])

                # 2. 각 표의 데이터 복구
                self.set_table_data(self.day_table, data.get('day_table', []), self.add_day_row)
                # ★ 수정: teacher_table 복구 시 add_teacher_row 함수를 사용하라고 지시!
                self.set_table_data(self.teacher_table, data.get('teacher_table', []), self.add_teacher_row)
                self.set_table_data(self.special_table, data.get('special_table', []), self.add_special_row)
                
                # ★ 중요: 과목 표 복구
                self.set_table_data(self.subject_table, data.get('subject_table', []))
                self.generate_timetables() # 뼈대를 미리 그려주기

                # 예외 표 데이터 복구
                loaded_exc = data.get('exception_tables_data', [])
                if loaded_exc and hasattr(self, 'exception_tables'):
                    for l_data in loaded_exc:
                        for ui_exc in self.exception_tables:
                            if ui_exc['day_text'] == l_data['day_text']:
                                ui_exc['table'].setRowCount(0)
                                for r_data in l_data['rows']:
                                    p, n, s = r_data[0], r_data[1], r_data[2]
                                    r_idx = ui_exc['table'].rowCount()
                                    ui_exc['table'].insertRow(r_idx)
                                    item_p = QTableWidgetItem(p); item_p.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                                    ui_exc['table'].setItem(r_idx, 0, item_p)
                                    item_n = QTableWidgetItem(n); item_n.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                                    ui_exc['table'].setItem(r_idx, 1, item_n)
                                    item_s = QTableWidgetItem(s); item_s.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                                    ui_exc['table'].setItem(r_idx, 2, item_s)
                                    
                                    btn_del = QPushButton('✕')
                                    btn_del.setStyleSheet("color: #e74c3c; border: none; font-weight: bold;")
                                    btn_del.clicked.connect(lambda _, t=ui_exc['table'], b=btn_del: self.delete_specific_row(t, b))
                                    ui_exc['table'].setCellWidget(r_idx, 3, btn_del)
                                ui_exc['table'].setFixedHeight(30 + (ui_exc['table'].rowCount() * 30) + 2)

                # 3. 화면 표시 전환
                if data.get('subject_table'):
                    self.subject_container.setVisible(True)
                    self.exception_container.setVisible(True)

                QMessageBox.information(self, "불러오기 완료", "과목 및 자습 버튼 상태까지 모두 복구되었습니다!")
            except Exception as e:
                QMessageBox.critical(self, "오류", f"파일을 읽는 중 문제가 발생했습니다.\n\n{e}")

    # (도우미 함수 1) 표에 적힌 글씨들을 리스트로 쭉 뽑아주는 기능
    def get_table_data(self, table):
        data = []
        for row in range(table.rowCount()):
            row_data = []
            for col in range(table.columnCount()):
                widget = table.cellWidget(row, col)
                if isinstance(widget, SubjectCellWidget):
                    subj_text = widget.subj_input.text()
                    # ★ 수정: 자습 버튼과 제외 버튼을 각각 따로 기억하기!
                    study_btns = [btn.text() for btn in widget.study_btns if btn.isChecked()]
                    exclude_btns = [btn.text() for btn in widget.exclude_btns if btn.isChecked()]
                    row_data.append({'text': subj_text, 'study_btns': study_btns, 'exclude_btns': exclude_btns})
                else:
                    if table in [self.day_table, self.special_table, self.teacher_table] and col == table.columnCount()-1:
                        continue
                    item = table.item(row, col)
                    row_data.append(item.text() if item else "")
            data.append(row_data)
        return data

    # (도우미 함수 2) 불러온 리스트 데이터를 표에 다시 예쁘게 채워넣는 기능
    def set_table_data(self, table, data, row_adder_func=None):
        table.setRowCount(0)
        max_classes = [self.spin_m1.value(), self.spin_m2.value(), self.spin_m3.value()]
        
        for row_idx, row_data in enumerate(data):
            if row_adder_func: row_adder_func()
            else: table.insertRow(row_idx)

            if table == self.subject_table:
                table.setRowHeight(row_idx, 120) # ★ 110에서 120으로 더 넉넉하게 연장!

            for col_idx, val in enumerate(row_data):
                # ★ 수정: 옛날 세이브 파일(active_btns)과 새 세이브 파일(study_btns) 모두 인식!
                if isinstance(val, dict) and ('study_btns' in val or 'active_btns' in val):
                    grade_idx = col_idx - 3 
                    widget = SubjectCellWidget(max_classes[grade_idx])
                    widget.subj_input.setText(val.get('text', ''))
                    
                    # 옛날 세이브 파일과 새 세이브 파일 모두 자습 버튼으로 완벽 복구
                    for btn in widget.study_btns:
                        if btn.text() in val.get('study_btns', []) or btn.text() in val.get('active_btns', []): 
                            btn.setChecked(True)
                            
                    # 제외 버튼 복구
                    for btn in widget.exclude_btns:
                        if btn.text() in val.get('exclude_btns', []): 
                            btn.setChecked(True)
                            
                    table.setCellWidget(row_idx, col_idx, widget)
                else:
                    item = table.item(row_idx, col_idx)
                    if not item:
                        item = QTableWidgetItem()
                        item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                        table.setItem(row_idx, col_idx, item)
                    item.setText(str(val))

    # =====================================================================
    # ★ 괄호 안의 숫자(자습/제외반)를 귀신같이 빼내는 판독기 (파이썬 버전)
    # =====================================================================
    def parse_grade_subject(self, raw_str):
        res = {
            'examName': '', 'studyClasses': [], 'excludeClasses': [], # ★ 제외반 목록 추가
            'isSpecial': False, 'specialRoomName': '', 'raw': raw_str.strip() if raw_str else ''
        }
        if not res['raw']: return res

        temp_str = res['raw']

        # 1. 특별실 추출
        if '*' in temp_str:
            res['isSpecial'] = True
            match_room = re.search(r'\*\(([^)]+)\)', temp_str)
            res['specialRoomName'] = match_room.group(1) if match_room else "8반"
            temp_str = temp_str.replace(f"*({res['specialRoomName']})", "").replace("*", "").strip()

        # 2. 🔴 제외반 추출 (제외:1,2)
        match_ex = re.search(r'\(제외:([^)]+)\)', temp_str)
        if match_ex:
            res['excludeClasses'] = [int(d) for d in re.findall(r'\d+', match_ex.group(1))]
            temp_str = temp_str.replace(match_ex.group(0), "").strip()

        # 3. 🟡 자습반 추출 (자습:1,2)
        match_st = re.search(r'\(자습:([^)]+)\)', temp_str)
        if match_st:
            res['studyClasses'] = [int(d) for d in re.findall(r'\d+', match_st.group(1))]
            temp_str = temp_str.replace(match_st.group(0), "").strip()
        elif '자습' in temp_str:
            res['studyClasses'] = list(range(1, 15)) 

        res['examName'] = temp_str.strip()
        if not res['examName'] and res['studyClasses']:
            res['examName'] = '자습'

        return res
    
    # =====================================================================
    # ★ 신규 추가: 이전 회차 누적 시수 장부 읽어오는 함수!
    # =====================================================================
    def load_previous_stats(self, term_num):
        file_path, _ = QFileDialog.getOpenFileName(self, f'{term_num-1}차 고사 누적 시수표 선택 (선택 안하면 0부터 시작)', '', 'Excel Files (*.xlsx *.xls)')
        cumulative_stats = {}
        
        if file_path:
            try:
                df = pd.read_excel(file_path, sheet_name="결과_시수표").fillna(0)
                
                for _, row in df.iterrows():
                    name = str(row.get('이름', '')).strip()
                    if name:
                        # ★ 핵심: 복잡한 횟수는 버리고, 최신 양식인 '전체총시수' 딱 하나만 마일리지로 읽어옵니다!
                        # (혹시 몰라 옛날 양식인 '합계'를 불러와도 에러 안 나게 방어막 설치)
                        prev_total = int(row.get('전체총시수', row.get('합계', 0)))
                        cumulative_stats[name] = {'currentHours': prev_total}
                        
                QMessageBox.information(self, "성공", f"기존 {len(cumulative_stats)}명의 누적 시수를 성공적으로 불러왔습니다!")
            except Exception as e:
                QMessageBox.warning(self, "오류", f"시수표 엑셀 파일을 읽는 중 문제가 발생했습니다.\n\n{e}\n\n모든 시수가 0으로 초기화된 상태로 시작합니다.")
        
        return cumulative_stats

    # =====================================================================
    # ★ 100회 몬테카를로 시뮬레이션 마스터 배정 엔진
    # =====================================================================
    def run_ai_assignment(self):
        if self.subject_table.rowCount() == 0:
            QMessageBox.warning(self, "경고", "먼저 [연동 생성하기]를 진행해 주세요.")
            return

       # 1. UI 데이터 수집 및 누적 시수 연동!
        current_term = self.term_combo.currentText() # 예: "2차 고사"
        term_num = int(current_term[0]) # 숫자만 쏙 빼기 (2)
        
        # ==========================================
        # ★ 수정: AI 단기 기억 장치 가동! (한 번 부른 엑셀은 꽉 쥐고 놓지 않기)
        # ==========================================
        # 1) 프로그램 켜고 처음 돌리는 거라 기억 장치가 아예 없다면 새로 하나 만들어 줍니다.
        if not hasattr(self, 'memory_cumulative_stats'):
            self.memory_cumulative_stats = {}
            self.memory_term_num = 0

        cumulative_stats = {}
        if term_num > 1:
            # 2) 만약 돌리려는 고사가 '방금 전 기억하고 있는 고사'와 똑같고, 손에 쥐고 있는 장부가 있다면?
            if self.memory_term_num == term_num and self.memory_cumulative_stats:
                cumulative_stats = self.memory_cumulative_stats # 귀찮게 묻지 않고 쥐고 있던 장부를 바로 씁니다!
            else:
                # 3) 처음 돌리거나 고사 회차가 바뀌었다면 팝업창을 띄워 정중하게 물어봅니다.
                reply = QMessageBox.question(self, '누적 시수 연동', f"이전 회차({term_num-1}차 고사)의 누적 시수를 이어받아 배정하시겠습니까?\n\n(아니오를 누르면 모두 0시간부터 새로 시작합니다.)", QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No, QMessageBox.StandardButton.Yes)
                if reply == QMessageBox.StandardButton.Yes:
                    cumulative_stats = self.load_previous_stats(term_num)
                    # ★ 핵심: 방금 불러온 장부를 다음번 '다시 돌리기'를 위해 뇌 속에 꽉 저장해 둡니다!
                    self.memory_cumulative_stats = cumulative_stats
                    self.memory_term_num = term_num
                else:
                    # '아니오'를 누르면 기억을 깨끗하게 비워줍니다.
                    self.memory_cumulative_stats = {}
                    self.memory_term_num = term_num
        
        initial_stats = {}
        for r in range(self.teacher_table.rowCount()):
            name = self.teacher_table.item(r, 1).text() if self.teacher_table.item(r, 1) else ""
            if name:
                t_subject = self.teacher_table.item(r, 2).text() if self.teacher_table.item(r, 2) else ""
                t_homeroom = self.teacher_table.item(r, 3).text() if self.teacher_table.item(r, 3) else ""
                t_type = self.teacher_table.item(r, 4).text() if self.teacher_table.item(r, 4) else "일반"

                # ★ 핵심: 4차 고사이면서 동시에 '체크박스에 체크가 되어있을 때만' 3학년을 제외합니다!
                # (체크를 풀면 일반 교사처럼 감독도 들어가고 예비도 들어갑니다)
                if current_term == "4차 고사" and self.check_exclude_3rd.isChecked():
                    if t_homeroom.startswith("3-") or t_homeroom == "3-부장":
                        t_type = "제외"

                target_str = self.teacher_table.item(r, 5).text() if self.teacher_table.item(r, 5) else ""
                try: target_hours = int(float(target_str))
                except ValueError: target_hours = 999
                
                # ★ 핵심: 장부에서 '전체 누적 마일리지'만 가져오고, 이번 시험 카운터는 0으로 리셋!
                my_history = cumulative_stats.get(name, {'currentHours': 0})
                
                initial_stats[name] = {
                    'name': name,
                    'subject': t_subject,
                    'homeroom': t_homeroom,
                    'type': t_type,
                    'targetHours': target_hours,
                    'currentHours': my_history['currentHours'], # 이전 시험까지의 누적 마일리지 장착!
                    'classHours': 0,        # ★ 이번 시험 교실 횟수 (무조건 0부터 시작)
                    'corridorHours': 0,     # ★ 이번 시험 복도 횟수 (무조건 0부터 시작)
                    'studyHallHours': 0,    # ★ 이번 시험 자습 횟수 (무조건 0부터 시작)
                    'assignedHistory': {}, 'visitedSlots': []
                }

        # 2. UI 데이터 수집 (특수실 및 예외)

        # 2. UI 데이터 수집 (특수실 및 예외)
        special_rooms = []
        for r in range(self.special_table.rowCount()):
            room = self.special_table.item(r, 0).text() if self.special_table.item(r, 0) else ""
            teacher = self.special_table.item(r, 1).text() if self.special_table.item(r, 1) else ""
            if room and teacher: special_rooms.append({'room': room, 'teacher': teacher})

        exceptions = []
        if hasattr(self, 'exception_tables'):
            for exc in self.exception_tables:
                day_idx = int(re.sub(r'[^0-9]', '', exc['day_text'])) - 1
                table = exc['table']
                for r in range(table.rowCount()):
                    period = table.item(r, 0).text() if table.item(r, 0) else ""
                    name = table.item(r, 1).text() if table.item(r, 1) else ""
                    if period and name: 
                        exceptions.append({'dayIndex': day_idx, 'period': period, 'name': name})

        # 3. UI 데이터 수집 (스케줄 및 과목)
        schedule = []
        day_idx_map = {}; current_day_idx = 0
        
        for r in range(self.subject_table.rowCount()):
            day_text = self.subject_table.item(r, 0).text()
            if day_text not in day_idx_map:
                day_idx_map[day_text] = current_day_idx
                current_day_idx += 1
                
            sch = {
                'dayIndex': day_idx_map[day_text], 'day': day_text, 
                'date': self.subject_table.item(r, 1).text(), 'period': self.subject_table.item(r, 2).text(), 'subjects': []
            }
            for col in [3, 4, 5]:
                widget = self.subject_table.cellWidget(r, col)
                if widget:
                    sub_name = widget.subj_input.text().strip()
                    # ★ 변경: AI가 알아들을 수 있게 (자습:1) (제외:2) 문자열 조합!
                    study_btns = [btn.text() for btn in widget.study_btns if btn.isChecked()]
                    exclude_btns = [btn.text() for btn in widget.exclude_btns if btn.isChecked()]
                    
                    tag = ""
                    if study_btns: tag += f"(자습:{','.join(study_btns)})"
                    if exclude_btns: tag += f"(제외:{','.join(exclude_btns)})"
                    
                    if tag: sch['subjects'].append(f"{sub_name if sub_name else '자습'}{tag}")
                    else: sch['subjects'].append(sub_name)
                else:
                    sch['subjects'].append("")
            schedule.append(sch)

        # ==========================================
        # ★ 본격적인 2000회 AI 초정밀 시뮬레이션 가동!
        # ==========================================
        btn_run = self.sender() # 버튼 글씨를 바꾸기 위해 가져옴
        btn_run.setText("⏳ AI 초정밀 배정 연산 중... (약 2~40초 소요)") # 문구 변경!
        QApplication.processEvents() # 화면 멈춤 방지

        best_result_data = []
        best_stats = {}
        best_total_score = 9999999

        unique_days = list(set([f"{sch['day']}_{sch['date']}" for sch in schedule]))
        total_days = len(unique_days) or 1
        headers = ["일차", "교시", "학년", "과목", "1반", "2반", "3반", "4반", "5반", "6반", "7반", "복도1", "복도2", "비고"]

        # ==========================================
        # ★ 수정: 500회 초고속 몬테카를로 시뮬레이션 (응답 없음 완벽 해결!)
        # ==========================================
        for attempt in range(500):
            # 1. '응답 없음' 방어막: 50번 계산할 때마다 화면(UI)에 숨 쉴 틈을 줍니다!
            if attempt % 50 == 0:
                QApplication.processEvents()
            
            # 2. 느려터진 copy.deepcopy를 버리고 '초고속 수동 세팅'으로 속도 100배 향상!
            current_stats = {}
            for k, v in initial_stats.items():
                current_stats[k] = {
                    'name': v['name'], 'subject': v['subject'], 'homeroom': v['homeroom'],
                    'type': v['type'], 'targetHours': v['targetHours'],
                    'currentHours': v['currentHours'], 
                    'classHours': 0, 'corridorHours': 0, 'studyHallHours': 0,
                    'assignedHistory': {}, 'visitedSlots': []
                }
                
            current_result_data = []
            shortage_count = 0
            last_day_index = -1

            # 원로교사 타겟 교시 배정
            for t in current_stats.values():
                if t['type'] == '원로':
                    t['targetPeriods'] = {dKey: random.randint(1, 3) for dKey in unique_days}

            for sch in schedule:
                day_key = f"{sch['day']}_{sch['date']}"
                if last_day_index != -1 and last_day_index != sch['dayIndex']:
                    current_result_data.append([""] * len(headers)) # 일차 구분 빈 줄
                last_day_index = sch['dayIndex']

                period_assignments = {1: [], 2: [], 3: []}
                pool = list(current_stats.values())

                period_exam_subjects = []
                parsed_grades = {1: None, 2: None, 3: None}
                for grade in [1, 2, 3]:
                    parsed = self.parse_grade_subject(sch['subjects'][grade-1])
                    parsed_grades[grade] = parsed
                    if parsed['examName'] and parsed['examName'] != '자습':
                        period_exam_subjects.append(parsed['examName'])

                # ★ 신규 추가: 각 학년별로 설정한 최대 반 개수(예: 5반) 가져오기!
                max_classes_per_grade = {1: self.spin_m1.value(), 2: self.spin_m2.value(), 3: self.spin_m3.value()}

                # ==========================================
                # ★ 1단계: 1, 2, 3학년의 모든 빈칸(Slot)을 하나의 거대한 바구니에 쓸어 담습니다.
                # ==========================================
                all_slots_for_period = []
                
                for grade in [1, 2, 3]:
                    parsed = parsed_grades[grade]
                    max_c = max_classes_per_grade[grade] 
                    
                    is_full_studyhall = (sch['subjects'][grade-1] == "자습")
                    should_skip_classroom = is_full_studyhall and (not self.check_assign_studyhall.isChecked())
                    
                    # 1~7반 기본 교실 배정
                    for c in range(1, 8):
                        if c <= max_c and not should_skip_classroom:
                            if c in parsed['excludeClasses']:
                                skip_this_class = True
                            else:
                                skip_this_class = False
                            
                            if not skip_this_class:
                                is_study = (parsed['examName'] == '자습') or (c in parsed['studyClasses'])
                                all_slots_for_period.append({'grade': grade, 'type': '교실', 'name': f"{grade}-{c}", 'isStudyHall': is_study})
                            else:
                                all_slots_for_period.append({'grade': grade, 'type': '빈칸', 'name': f"{grade}-{c}", 'isStudyHall': False})
                        else:
                            all_slots_for_period.append({'grade': grade, 'type': '빈칸', 'name': f"{grade}-{c}", 'isStudyHall': False})
                    
                    # 특별실
                    if parsed.get('isSpecial'):
                        special_name = f"{grade}-{parsed['specialRoomName']}"
                        all_slots_for_period.append({
                            'grade': grade, 'type': '교실', 
                            'name': special_name, 
                            'isStudyHall': False,
                            'roomName': parsed['specialRoomName'] 
                        })
                    else:
                        all_slots_for_period.append({'grade': grade, 'type': '빈칸', 'name': '특별실_공란', 'isStudyHall': False})

                    # 복도 감독
                    all_slots_for_period.append({'grade': grade, 'type': '복도', 'name': f"{grade}-복도1", 'isStudyHall': False})
                    all_slots_for_period.append({'grade': grade, 'type': '복도', 'name': f"{grade}-복도2", 'isStudyHall': False})

                # ==========================================
                # ★ 2단계: 블랙홀 파괴! 진짜 배정해야 할 빈칸들을 마구잡이로 섞어버립니다(Shuffle).
                # ==========================================
                # 빈칸(빈자리)이 아닌 진짜 슬롯들의 '참조(주소)'만 모아서 제비뽑기 통에 넣습니다.
                valid_slots = [s for s in all_slots_for_period if s['type'] != '빈칸']
                random.shuffle(valid_slots)

                # ==========================================
                # ★ 3단계: 제비뽑기 순서대로 선생님을 배정합니다.
                # ==========================================
                for slot in valid_slots:
                    grade = slot['grade']
                    p_int = int(sch['period'])
                    
                    available = []
                    for t in pool:
                        if t['type'] == '제외': continue
                        
                        # 순회 교사 차단 방어막 (일반 교실)
                        if t['type'] == '순회' and slot['type'] == '교실' and not slot['isStudyHall']:
                            continue
                        
                        if t['type'] == '원로':
                            if slot['type'] == '복도' or slot['isStudyHall']: continue
                            current_exam_hours = t['classHours'] + t['corridorHours'] + t['studyHallHours']
                            if current_exam_hours >= t['targetHours']: continue
                            daily_max = (t['targetHours'] + total_days - 1) // total_days
                            if len(t['assignedHistory'].get(day_key, [])) >= daily_max: continue

                        if t['type'] == '고사담당' and p_int > 1: continue

                        my_subs = [s.strip() for s in re.split(r'[/,]', t['subject']) if s.strip()]
                        has_exam = False
                        if my_subs:
                            for subj in period_exam_subjects:
                                split_subjs = [s.strip() for s in re.split(r'[/,]', subj)]
                                if any(ms in split_subjs for ms in my_subs): has_exam = True; break

                        if t['type'] == '고사담당' and p_int == 1 and not has_exam: pass
                        else:
                            if has_exam: continue
                            if any(ex['dayIndex'] == sch['dayIndex'] and ex['period'] == sch['period'] and ex['name'] == t['name'] for ex in exceptions): continue
                            if any(sr['teacher'] == t['name'] for sr in special_rooms): continue

                            history = t['assignedHistory'].get(day_key, [])
                            if (p_int - 1) in history and (p_int - 2) in history: continue
                            if p_int in history: continue

                        available.append(t)

                    random.shuffle(available)
                    
                    def sort_key(a):
                        a_today = len(a['assignedHistory'].get(day_key, []))
                        a_is_exam = 1 if (a['type'] == '고사담당' and p_int == 1) else 0
                        a_target_p = a.get('targetPeriods', {}).get(day_key, 1) if a['type'] == '원로' else 1
                        a_sr_ready = 1 if (a['type'] == '원로' and p_int >= a_target_p) else 0
                        a_sr_early = 1 if (a['type'] == '원로' and p_int < a_target_p) else 0
                        
                        # ★ 순회 교사의 자습/복도 프리패스 룰은 그대로 유지!
                        is_itinerant_priority = 0
                        if slot['isStudyHall'] or slot['type'] == '복도':
                            if a['type'] == '순회':
                                is_itinerant_priority = -1 
                            else:
                                is_itinerant_priority = 1  
                        
                        if slot['isStudyHall'] or slot['type'] == '복도':
                            target_hours = a['studyHallHours'] + a['corridorHours']
                        else:
                            target_hours = a['classHours']
                            
                        current_exam_total = a['classHours'] + a['corridorHours'] + a['studyHallHours']
                        
                        return (
                            a_today,                
                            is_itinerant_priority,  
                            -a_is_exam,          
                            -a_sr_ready,         
                            a_sr_early,          
                            target_hours,           
                            current_exam_total,     
                            a['currentHours']       
                        )

                    available.sort(key=sort_key)

                    assigned_idx = -1
                    for i, t in enumerate(available):
                        # ★ 궁극의 방탄 코드: 작대기 길이, 특수문자 다 무시하고 '순수 숫자'만 뽑아냅니다!
                        hm_nums = re.findall(r'\d+', str(t['homeroom']))  # 예: "2–5" -> ['2', '5']
                        slot_nums = re.findall(r'\d+', str(slot['name'])) # 예: "2-5" -> ['2', '5']
                        
                        is_my_homeroom = False
                        # 뽑아낸 숫자가 2개(학년, 반) 있고, 그 둘이 완벽히 똑같을 때만 '내 담임반'으로 판정!
                        if len(hm_nums) >= 2 and len(slot_nums) >= 2:
                            if hm_nums[0] == slot_nums[0] and hm_nums[1] == slot_nums[1]:
                                is_my_homeroom = True

                        # 담임이 자기 반(is_my_homeroom)에 들어가는 것만 얄짤없이 막습니다!
                        if not (slot['type'] == '교실' and is_my_homeroom):
                            assigned_idx = i; break

                    if assigned_idx != -1:
                        sel = available[assigned_idx]
                        
                        if 'roomName' in slot:
                            slot['assigned_result'] = f"{sel['name']}({slot['roomName']})"
                        else:
                            slot['assigned_result'] = sel['name']
                            
                        sel['currentHours'] += 1
                        
                        if slot['isStudyHall']: 
                            sel['studyHallHours'] += 1
                        elif slot['type'] == '복도':
                            sel['corridorHours'] += 1
                        elif slot['type'] == '교실':
                            sel['classHours'] += 1
                        
                        if day_key not in sel['assignedHistory']: sel['assignedHistory'][day_key] = []
                        sel['assignedHistory'][day_key].append(p_int)
                        sel['visitedSlots'].append(slot['name'])
                        pool = [p for p in pool if p['name'] != sel['name']]
                    else:
                        slot['assigned_result'] = "부족"
                        shortage_count += 1

                # ==========================================
                # ★ 4단계: 배정이 끝난 슬롯들을 원래 학년별 순서대로 엑셀 출력용 리스트에 쪼개 담습니다!
                # ==========================================
                for slot in all_slots_for_period:
                    grade = slot['grade']
                    if slot['type'] == '빈칸':
                        period_assignments[grade].append("")
                    else:
                        period_assignments[grade].append(slot.get('assigned_result', '오류'))

                special_str = ", ".join([f"{sr['room']}({sr['teacher']})" for sr in special_rooms])
                current_result_data.append([f"{sch['day']} {sch['date']}", sch['period'], "1학년", sch['subjects'][0]] + period_assignments[1] + [special_str])
                current_result_data.append(["", "", "2학년", sch['subjects'][1]] + period_assignments[2] + [""])
                current_result_data.append(["", "", "3학년", sch['subjects'][2]] + period_assignments[3] + [""])

            senior_penalty = 0
            for t in current_stats.values():
                if t['type'] == '원로':
                    current_exam_hours = t['classHours'] + t['corridorHours'] + t['studyHallHours']
                    if current_exam_hours < t['targetHours']:
                        senior_penalty += (t['targetHours'] - current_exam_hours) * 1000

           # ==========================================
            # ★ 핵심 수정: 일반 교사들의 3대 시수(전체, 복도/자습, 교실)를 모두 채점!
            # ==========================================
            regular_total_hours = []
            regular_sub_hours = []   
            regular_class_hours = [] 
            
            for t in current_stats.values():
                # ★ 신규 추가: '순회' 선생님을 채점 명단에서 조용히 빼줍니다. (제외, 원로, 순회)
                if t['type'] not in ['제외', '원로', '순회']:
                    regular_total_hours.append(t['currentHours'])
                    regular_sub_hours.append(t['corridorHours'] + t['studyHallHours'])
                    regular_class_hours.append(t['classHours'])
            
            balance_penalty = 0
            if regular_total_hours:
                # 1. '전체 총시수' 쏠림 채점 (가장 중요)
                avg_total = sum(regular_total_hours) / len(regular_total_hours)
                var_total = sum((h - avg_total) ** 2 for h in regular_total_hours)
                
                # 2. '복도+자습 시수' 쏠림 채점 
                avg_sub = sum(regular_sub_hours) / len(regular_sub_hours)
                var_sub = sum((h - avg_sub) ** 2 for h in regular_sub_hours)

                # 3. ★ 신규: '교실 시수' 쏠림 채점 
                avg_class = sum(regular_class_hours) / len(regular_class_hours)
                var_class = sum((h - avg_class) ** 2 for h in regular_class_hours)
                
                # ★ 최종 벌점: 전체 시수 격차를 최우선(x100)으로 잡고, 복도/자습(x50)과 교실(x50) 쏠림도 깐깐하게 벌점을 매깁니다!
                balance_penalty = int((var_total * 100) + (var_sub * 50) + (var_class * 50)) 

            # 총점에 격차 페널티를 더해줍니다.
            total_score = (shortage_count * 10000) + senior_penalty + balance_penalty

            # 베스트 결과 갱신
            if total_score < best_total_score:
                best_total_score = total_score
                best_result_data = current_result_data
                best_stats = current_stats
                
            # ★ 삭제: if total_score == 0: break 
            # (첫 번째 결과에서 멈추지 말고 100번 다 돌면서 가장 밸런스 좋은 걸 찾아라!) 

        # ==========================================
        # 4. 결과 데이터 정리 (제목을 '특별실'로 깔끔하게 고정!)
        # ==========================================
        headers = ["일차", "교시", "학년", "과목", "1반", "2반", "3반", "4반", "5반", "6반", "7반", "특별실", "복도1", "복도2", "비고"]
        df_schedule = pd.DataFrame(best_result_data, columns=headers)
        
        # 5. 시수 통계 데이터 정리 (결과_시수표)
        stat_headers = ["연번", "이름", "구분", "과목", "교실", "복도", "자습", "현재총시수", "전체총시수"]
        stat_data = []
        
        for i, t in enumerate(best_stats.values()):
            current_exam_total = t['classHours'] + t['corridorHours'] + t['studyHallHours']
            stat_data.append([
                i+1, t['name'], t['type'], t['subject'], 
                t['classHours'], t['corridorHours'], t['studyHallHours'], 
                current_exam_total, t['currentHours']
            ])
        df_stats = pd.DataFrame(stat_data, columns=stat_headers)

        # 6. 개인별 시간표 및 예비 명단 생성
        valid_periods = []
        for i in range(len(best_result_data)):
            if best_result_data[i][2] == "1학년":
                valid_periods.append({
                    'day_info': best_result_data[i][0], 'period': best_result_data[i][1],
                    'r1': best_result_data[i], 'r2': best_result_data[i+1], 'r3': best_result_data[i+2]
                })

        pt_data = []
        period_reserves = [[] for _ in range(len(valid_periods))]

        count = 1
        for t_name, t_info in best_stats.items():
            # ★ 신규 추가: 이름 옆에 '과목' 정보를 추가합니다!
            row = [count, t_name, t_info['subject']] 
            for p_idx, vp in enumerate(valid_periods):
                assigned_room = ""
                for g_idx, g_row in enumerate([vp['r1'], vp['r2'], vp['r3']]):
                    for col in range(4, 14): 
                        cell_val = str(g_row[col])
                        if cell_val == t_name or cell_val.startswith(f"{t_name}("):
                            if col <= 10: 
                                room_label = str(col - 3)
                            elif col == 11: 
                                parsed = self.parse_grade_subject(g_row[3] if g_row[3] else "")
                                room_label = parsed.get('specialRoomName', '특별실') if parsed.get('isSpecial') else '특별실'
                            elif col == 12: room_label = "복도1"
                            elif col == 13: room_label = "복도2"
                            
                            # ★ 핵심 추가: 자습 교실인 경우 이름표 뒤에 (자습) 마커 달기!
                            is_study = False
                            header_val = str(g_row[3] if g_row[3] else "")
                            if "자습" in header_val:
                                p_obj = self.parse_grade_subject(header_val)
                                if p_obj['examName'] == '자습' or (col <= 10 and (col-3) in p_obj['studyClasses']):
                                    is_study = True
                            
                            assigned_room = f"{g_idx+1}-{room_label}"
                            if is_study: assigned_room += "(자습)"
                            break
                    if assigned_room: break
                
                if not assigned_room and vp['r1'][14] and t_name in vp['r1'][14]:
                    assigned_room = "특수실"
                
                has_exam_now = False
                period_exam_subjects = []
                for g_row in [vp['r1'], vp['r2'], vp['r3']]:
                    parsed_ex = self.parse_grade_subject(g_row[3] if g_row[3] else "")
                    if parsed_ex['examName'] and parsed_ex['examName'] != '자습':
                        period_exam_subjects.append(parsed_ex['examName'])
                
                my_subs = [s.strip() for s in re.split(r'[/,]', t_info['subject']) if s.strip()]
                if my_subs:
                    for subj in period_exam_subjects:
                        split_subjs = [s.strip() for s in re.split(r'[/,]', subj)]
                        if any(ms in split_subjs for ms in my_subs): has_exam_now = True; break

                if not assigned_room:
                    if has_exam_now:
                        assigned_room = "본인시험_마커" 
                    else:
                        is_reserve_eligible = True
                        if t_info['type'] == '고사담당': is_reserve_eligible = False
                        if t_info['type'] == '제외': is_reserve_eligible = False 
                        
                        day_idx = int(re.sub(r'[^0-9]', '', vp['day_info'].split()[0])) - 1
                        current_p = vp['period']
                        if any(ex['dayIndex'] == day_idx and ex['period'] == current_p and ex['name'] == t_name for ex in exceptions):
                            is_reserve_eligible = False

                        if is_reserve_eligible:
                            period_reserves[p_idx].append({'name': t_name, 'hours': t_info['currentHours']})

                row.append(assigned_room)

            current_exam_total = t_info['classHours'] + t_info['corridorHours'] + t_info['studyHallHours']
            row.extend([t_info['classHours'], t_info['corridorHours'], t_info['studyHallHours'], current_exam_total, t_info['currentHours']])
            pt_data.append(row)
            count += 1

        # ★ 선생님이 지적해주셨던 원래 변수 그대로 사용!
        max_reserves = max([len(r) for r in period_reserves]) if period_reserves else 0
        for r_idx in range(max_reserves):
            res_row = [r_idx + 1, "예비", ""]  # ★ 신규 추가: 예비 줄에도 과목용 빈칸 추가
            for p_idx in range(len(valid_periods)):
                if r_idx < len(period_reserves[p_idx]):
                    period_reserves[p_idx].sort(key=lambda x: x['hours'])
                    res_row.append(f"{period_reserves[p_idx][r_idx]['name']}({period_reserves[p_idx][r_idx]['hours']})")
                else: res_row.append("")
            res_row.extend(["", "", "", "", ""]) 
            pt_data.append(res_row)

        pt_headers_r1 = ["연번", "이름", "과목"] # ★ 신규 추가: 과목 헤더
        pt_headers_r2 = ["", "", ""]
        pt_headers_r3 = ["", "", ""]
        pt_headers_r4 = ["", "", ""]
        pt_headers_r5 = ["", "", ""]

        day_col_counts = {}
        day_names_order = []

        for vp in valid_periods:
            day_name = vp['day_info'].replace("\n", " ")
            if day_name not in day_col_counts:
                day_col_counts[day_name] = 0
                day_names_order.append(day_name)
            day_col_counts[day_name] += 1

            pt_headers_r1.append(day_name)
            pt_headers_r2.append(f"{vp['period']}교시")
            pt_headers_r3.append(f"1학년\n{vp['r1'][3]}" if vp['r1'][3] else "")
            pt_headers_r4.append(f"2학년\n{vp['r2'][3]}" if vp['r2'][3] else "")
            pt_headers_r5.append(f"3학년\n{vp['r3'][3]}" if vp['r3'][3] else "")

        pt_headers_r1.extend(["교실", "복도", "자습", "현재총시수", "전체총시수"])
        pt_headers_r2.extend(["", "", "", "", ""])
        pt_headers_r3.extend(["", "", "", "", ""])
        pt_headers_r4.extend(["", "", "", "", ""])
        pt_headers_r5.extend(["", "", "", "", ""])

        full_pt_data = [pt_headers_r1, pt_headers_r2, pt_headers_r3, pt_headers_r4, pt_headers_r5] + pt_data
        df_personal = pd.DataFrame(full_pt_data)

        # 7. [미리보기] 팝업창 띄우기 (엑셀 저장 전 검토 단계)
        btn_run.setText("🚀 배정 시작!") 
        
        preview = PreviewDialog(df_schedule, df_personal, self)
        result = preview.exec()

        if result == 0: 
            return
        elif result == 2: 
            self.run_ai_assignment() 
            return

        default_filename = f"부광고_{current_term.replace(' ', '')}_배정결과.xlsx"
        file_path, _ = QFileDialog.getSaveFileName(self, '배정 결과 저장', default_filename, 'Excel Files (*.xlsx)')
        
        if file_path:
            try:
                from openpyxl.formatting.rule import FormulaRule # ★ 조건부 서식 마법 도구
                
                with pd.ExcelWriter(file_path, engine='openpyxl') as writer:
                    df_schedule.to_excel(writer, index=False, sheet_name="결과_감독표")
                    df_stats.to_excel(writer, index=False, sheet_name="결과_시수표")
                    df_personal.to_excel(writer, index=False, header=False, sheet_name="결과_개인별시간표")
                    
                    workbook = writer.book
                    from openpyxl.utils import get_column_letter
                    
                    fill_green = PatternFill("solid", fgColor="D9EAD3")
                    fill_yellow = PatternFill("solid", fgColor="FFF2CC")
                    fill_pink = PatternFill("solid", fgColor="FCE4EC")
                    fill_header = PatternFill("solid", fgColor="E2EFDA")
                    fill_purple = PatternFill("solid", fgColor="E8DAEF") 
                    fill_blue = PatternFill("solid", fgColor="D6EAF8")   
                    border_thin = Border(left=Side(style='thin'), right=Side(style='thin'), top=Side(style='thin'), bottom=Side(style='thin'))
                    align_center = Alignment(horizontal='center', vertical='center', wrap_text=True)
                    align_shrink = Alignment(horizontal='center', vertical='center', shrink_to_fit=True)
                    align_no_wrap = Alignment(horizontal='center', vertical='center', wrap_text=False)

                    # ==================================================
                    # [1] 결과_감독표 서식
                    # ==================================================
                    ws1 = writer.sheets["결과_감독표"]
                    for cell in ws1[1]: 
                        cell.fill = fill_green; cell.font = Font(bold=True)
                        cell.border = border_thin; cell.alignment = align_center
                    
                    ws1.column_dimensions['D'].width = 25 
                    ws1.column_dimensions['O'].width = 60 
                    ws1.row_dimensions[1].height = 35     
                    
                    for r_idx in range(2, ws1.max_row + 1):
                        subj_val = ws1.cell(row=r_idx, column=4).value
                        parsed = self.parse_grade_subject(str(subj_val)) if subj_val else {'examName': '', 'studyClasses': []}
                        
                        is_spacer_row = not ws1.cell(row=r_idx, column=1).value and not ws1.cell(row=r_idx, column=3).value
                        
                        if is_spacer_row:
                            ws1.row_dimensions[r_idx].height = 12 
                        else:
                            ws1.row_dimensions[r_idx].height = 35 

                        for c_idx in range(1, ws1.max_column + 1):
                            cell = ws1.cell(row=r_idx, column=c_idx)
                            cell.alignment = align_center
                            if is_spacer_row:
                                cell.border = Border(top=Side(style='thin'), bottom=Side(style='thin'))
                            else:
                                cell.border = border_thin
                                if 5 <= c_idx <= 12: 
                                    class_num = c_idx - 4
                                    if parsed['examName'] == '자습' or class_num in parsed['studyClasses']:
                                        cell.fill = fill_yellow
                                elif c_idx == 4:
                                    if parsed['examName'] == '자습' or parsed['studyClasses']:
                                        cell.fill = fill_yellow

                    def merge_col(ws, col_idx):
                        start_row = 2
                        while start_row <= ws.max_row:
                            val = ws.cell(row=start_row, column=col_idx).value
                            if val and str(val).strip() and start_row + 2 <= ws.max_row:
                                ws.merge_cells(start_row=start_row, start_column=col_idx, end_row=start_row+2, end_column=col_idx)
                                start_row += 3 
                            else:
                                start_row += 1 
                    merge_col(ws1, 1); merge_col(ws1, 2)

                    # ==================================================
                    # [2] 결과_시수표 서식
                    # ==================================================
                    ws2 = writer.sheets["결과_시수표"]
                    for cell in ws2[1]: 
                        cell.fill = fill_yellow; cell.font = Font(bold=True); cell.alignment = align_no_wrap 
                    for row in ws2.iter_rows(min_row=1, max_row=ws2.max_row, min_col=1, max_col=ws2.max_column):
                        for cell in row: 
                            cell.border = border_thin
                            if cell.row > 1: cell.alignment = align_center
                            
                    # ★ 수정: 과목 열(D) 너비를 18에서 36으로 대폭 확장!
                    ws2.column_dimensions['D'].width = 36
                    ws2.column_dimensions['H'].width = 14
                    ws2.column_dimensions['I'].width = 14

                    # ==================================================
                    # [3] 결과_개인별시간표 서식 및 텍스트/조건부서식 적용
                    # ==================================================
                    ws3 = writer.sheets["결과_개인별시간표"]
                    ws3.merge_cells('A1:A5'); ws3.merge_cells('B1:B5'); ws3.merge_cells('C1:C5')
                    stats_start_col = 4 + len(valid_periods)
                    for i in range(5): ws3.merge_cells(start_row=1, start_column=stats_start_col+i, end_row=5, end_column=stats_start_col+i)

                    current_col = 4
                    for day_name in day_names_order:
                        span = day_col_counts[day_name]
                        if span > 1: ws3.merge_cells(start_row=1, start_column=current_col, end_row=1, end_column=current_col + span - 1)
                        current_col += span

                    for r_idx, row in enumerate(ws3.iter_rows(min_row=1, max_row=ws3.max_row, min_col=1, max_col=ws3.max_column), 1):
                        is_reserve = str(ws3.cell(row=r_idx, column=2).value) == "예비"
                        for cell in row:
                            cell.border = border_thin; cell.alignment = align_center 
                            
                            if r_idx <= 5:
                                cell.fill = fill_header
                                if r_idx >= 3 and cell.value and "자습" in str(cell.value): cell.fill = fill_yellow
                            else:
                                if is_reserve: 
                                    cell.fill = fill_pink
                                    cell.alignment = align_no_wrap 
                                elif cell.column == 3:
                                    cell.alignment = align_shrink
                                else:
                                    if cell.column >= 4 and cell.column < stats_start_col:
                                        cell.number_format = '@' 
                                        
                                        val = str(cell.value or "")
                                        if val == "본인시험_마커":
                                            cell.value = ""; cell.fill = fill_blue 
                                        
                                    if cell.column >= stats_start_col:
                                        t_row = cell.row
                                        range_addr = f"{get_column_letter(4)}{t_row}:{get_column_letter(stats_start_col-1)}{t_row}"
                                        if cell.column == stats_start_col:
                                            cell.value = f'=COUNTIFS({range_addr}, "*-*", {range_addr}, "<>*자습*", {range_addr}, "<>*복도*")'
                                        elif cell.column == stats_start_col + 1:
                                            cell.value = f'=COUNTIF({range_addr}, "*복도*")'
                                        elif cell.column == stats_start_col + 2:
                                            cell.value = f'=COUNTIFS({range_addr}, "*자습*", {range_addr}, "<>*복도*")'
                                        elif cell.column == stats_start_col + 3:
                                            cell.value = f'=SUM({get_column_letter(stats_start_col)}{t_row}:{get_column_letter(stats_start_col+2)}{t_row})'

                    # ==================================================
                    # ★ 조건부 서식 등록
                    # ==================================================
                    data_range = f"D6:{get_column_letter(stats_start_col-1)}{ws3.max_row}"
                    cf_fill_purple = PatternFill(start_color="E8DAEF", end_color="E8DAEF", fill_type="solid")
                    cf_fill_yellow = PatternFill(start_color="FFF2CC", end_color="FFF2CC", fill_type="solid")

                    ws3.conditional_formatting.add(data_range, FormulaRule(formula=[f'ISNUMBER(SEARCH("복도", D6))'], fill=cf_fill_purple))
                    ws3.conditional_formatting.add(data_range, FormulaRule(formula=[f'ISNUMBER(SEARCH("(자습)", D6))'], fill=cf_fill_yellow))

                    for r_idx in range(2, ws2.max_row + 1):
                        name_in_stat = str(ws2.cell(row=r_idx, column=2).value)
                        for r_p in range(6, ws3.max_row + 1):
                            if str(ws3.cell(row=r_p, column=2).value) == name_in_stat:
                                for i, offset in enumerate([0, 1, 2, 3]):
                                    ws2.cell(row=r_idx, column=5+i).value = f"='결과_개인별시간표'!{get_column_letter(stats_start_col+offset)}{r_p}"
                                break

                    ws3.column_dimensions['A'].width = 5
                    ws3.column_dimensions['B'].width = 10
                    ws3.column_dimensions['C'].width = 14
                    for c in range(4, stats_start_col): ws3.column_dimensions[get_column_letter(c)].width = 13
                    
                    # ★ 수정: 통계 5개 열(교실, 복도, 자습, 현재, 전체) 너비를 11에서 5로 슬림하게 확 줄였습니다!
                    for c in range(stats_start_col, stats_start_col + 5): ws3.column_dimensions[get_column_letter(c)].width = 5

                QMessageBox.information(self, "완료", f"🎉 {current_term} 배정 및 모든 엑셀 세팅(너비 포함) 완벽 적용!")
            except Exception as e:
                QMessageBox.critical(self, "오류", f"엑셀 저장 중 오류 발생:\n{e}")

        btn_run.setText("🚀 배정 시작!")            

        # =====================================================================
    # ★ 신규 추가: 팝업창을 열고, 데이터를 메인 화면에 뿌려주는 기능
    # =====================================================================
    def open_batch_input(self):
        if self.subject_table.rowCount() == 0: return
        
        # 1. 현재 화면에 적혀있던 과목 정보 긁어오기 (기존 글씨 날아가지 않게)
        current_data = []
        for r in range(self.subject_table.rowCount()):
            day = self.subject_table.item(r, 0).text()
            date = self.subject_table.item(r, 1).text()
            period = self.subject_table.item(r, 2).text()
            
            w1 = self.subject_table.cellWidget(r, 3)
            w2 = self.subject_table.cellWidget(r, 4)
            w3 = self.subject_table.cellWidget(r, 5)
            
            s1 = w1.subj_input.text() if w1 else ""
            s2 = w2.subj_input.text() if w2 else ""
            s3 = w3.subj_input.text() if w3 else ""
            
            current_data.append([day, date, period, s1, s2, s3])
            
        # 2. 팝업창 띄우기!
        dialog = SubjectInputDialog(current_data, self)
        
        # 3. 사용자가 팝업창에서 [OK]를 눌렀다면?
        if dialog.exec() == QDialog.DialogCode.Accepted:
            for r in range(self.subject_table.rowCount()):
                s1 = dialog.table.item(r, 3).text() if dialog.table.item(r, 3) else ""
                s2 = dialog.table.item(r, 4).text() if dialog.table.item(r, 4) else ""
                s3 = dialog.table.item(r, 5).text() if dialog.table.item(r, 5) else ""
                
                # 메인 화면에 있는 복잡한 커스텀 위젯에 과목명 쏙쏙 박아넣기!
                w1 = self.subject_table.cellWidget(r, 3)
                w2 = self.subject_table.cellWidget(r, 4)
                w3 = self.subject_table.cellWidget(r, 5)
                
                if w1: w1.subj_input.setText(s1)
                if w2: w2.subj_input.setText(s2)
                if w3: w3.subj_input.setText(s3)
    
    def add_specific_row(self, table):
        r_idx = table.rowCount()
        table.insertRow(r_idx)
        for col in range(3):
            item = QTableWidgetItem(""); item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
            table.setItem(r_idx, col, item)
        btn_del = QPushButton('✕')
        btn_del.setStyleSheet("color: #e74c3c; border: none; font-weight: bold;")
        btn_del.clicked.connect(lambda _, t=table, b=btn_del: self.delete_specific_row(t, b))
        table.setCellWidget(r_idx, 3, btn_del)
        table.setFixedHeight(30 + (table.rowCount() * 30) + 2)

    def delete_specific_row(self, table, button):
        for row in range(table.rowCount()):
            if table.cellWidget(row, 3) == button:
                table.removeRow(row)
                break
        table.setFixedHeight(30 + (table.rowCount() * 30) + 2)

if __name__ == '__main__':
    app = QApplication(sys.argv)

    # ==================================================
    # 🔒 라이선스 철통 방어 시스템 시작
    # ==================================================
    import urllib.request
    import hashlib
    import datetime
    from PyQt6.QtWidgets import QInputDialog, QMessageBox

    try:
        # 1. 구글 서버 시계를 몰래 확인 (컴퓨터 날짜 꼼수 완벽 차단)
        res = urllib.request.urlopen('http://www.google.com', timeout=3)
        date_str = res.headers['Date']
        current_year = str(datetime.datetime.strptime(date_str, "%a, %d %b %Y %H:%M:%S %Z").year)
    except Exception:
        # 2. 인터넷이 안 끊긴다? 내장 시계 안 봅니다! 얄짤없이 튕겨냅니다.
        QMessageBox.critical(None, "네트워크 오류", "라이선스 인증을 위해 인터넷 연결이 필수입니다.\n인터넷을 연결하고 다시 실행해주세요.")
        sys.exit()

   
    # 3. 올해의 '진짜 암호' 몰래 계산하기
    secret = "이용휘123!" # ★ keygen.py 에 적은 것과 토시 하나 안 틀리고 똑같아야 합니다!
    raw_text = f"{current_year}-{secret}"
    hash_obj = hashlib.sha256(raw_text.encode('utf-8'))
    hex_dig = hash_obj.hexdigest().upper()
    correct_key = f"{hex_dig[0:4]}-{hex_dig[4:8]}-{hex_dig[8:12]}-{hex_dig[12:16]}"

    # 4. 검문소(팝업창) 열기
    key_input, ok = QInputDialog.getText(None, '라이선스 인증', f'🔒 {current_year}년도 라이선스 키를 입력하세요:')

    if not ok or key_input.strip().upper() != correct_key:
        QMessageBox.critical(None, "인증 실패", "유효하지 않은 라이선스 키입니다.\n이용휘 선생님께 문의하세요.")
        sys.exit() # 암호 틀리면 얄짤없이 강제 종료!
    # ==================================================
    # 🔒 라이선스 철통 방어 시스템 끝
    # ==================================================

    ex = ExamScheduler()
    ex.show()
    sys.exit(app.exec())