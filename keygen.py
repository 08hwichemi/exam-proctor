import hashlib

def generate_key(year):
    # ★ 선생님만의 비밀 단어 (절대 유출 금지!)
    secret = "이용휘123!" 
    
    # 연도와 비밀 단어를 믹서기(SHA-256)에 넣고 갈아버림
    raw_text = f"{year}-{secret}"
    hash_obj = hashlib.sha256(raw_text.encode('utf-8'))
    hex_dig = hash_obj.hexdigest().upper()
    
    # 16자리 암호로 예쁘게 자르기 (예: A1B2-C3D4-E5F6-G7H8)
    key = f"{hex_dig[0:4]}-{hex_dig[4:8]}-{hex_dig[8:12]}-{hex_dig[12:16]}"
    return key

if __name__ == "__main__":
    print("====================================")
    print(" 🔑 부광고 시험배정 마스터 키 생성기 ")
    print("====================================")
    
    target_year = input("▶ 발급할 연도를 입력하세요 (예: 2026): ")
    
    print(f"\n✅ {target_year}년도 라이선스 키가 발급되었습니다:")
    print(f"👉 {generate_key(target_year)} 👈")
    print("\n이 키를 복사해서 선생님들께 전달하세요!")
    input("\n종료하려면 엔터를 누르세요...")