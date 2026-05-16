// cpp/core.cpp
#include <emscripten.h>
#include <string>
#include <cstdint>

extern "C"
{
    // 送信前のメッセージを精査し、0〜100の「信号整合性」を返す
    EMSCRIPTEN_KEEPALIVE
    int check_signal_integrity(const char *message)
    {
        std::string msg(message);

        // プロトタイプ用の簡易ノイズ（誹謗中傷）検知
        // 本来はここに高度なアルゴリズムを実装していく
        if (msg.find("死ね") != std::string::npos || msg.find("消えろ") != std::string::npos)
        {
            return 20; // ノイズ過多（Integrity Low）
        }

        if (msg.length() == 0)
            return 0;

        return 100; // 良好（Integrity High）
    }

    // WIRER PoW Spam Prevention Engine
    EMSCRIPTEN_KEEPALIVE
    int mine_pow(const char* message, int difficulty) {
        std::string msg(message);
        
        // Calculate bitmask for checking ending zeros. 
        // difficulty = 1 -> mask 0xF (1 hex zero)
        // difficulty = 4 -> mask 0xFFFF (4 hex zeros)
        uint32_t mask = (1 << (difficulty * 4)) - 1;
        
        int nonce = 0;
        while (true) {
            std::string input = msg + std::to_string(nonce);
            uint32_t hash = 2166136261u; // FNV-1a basis
            
            for (char c : input) {
                hash ^= static_cast<uint8_t>(c);
                hash *= 16777619u;
            }
            
            // Artificial computational weight (slows down attackers significantly)
            for(int i = 0; i < 500; i++) {
                hash ^= static_cast<uint32_t>(i);
                hash *= 16777619u;
            }

            if ((hash & mask) == 0) {
                return nonce; // Found valid Proof of Work!
            }
            
            nonce++;
            
            // Safety limit to prevent absolute lockups
            if (nonce > 10000000) {
                return -1;
            }
        }
    }

    // PoW Verification Engine (Used by receivers to validate incoming messages)
    EMSCRIPTEN_KEEPALIVE
    int verify_pow(const char* message, int nonce, int difficulty) {
        std::string msg(message);
        uint32_t mask = (1 << (difficulty * 4)) - 1;
        
        std::string input = msg + std::to_string(nonce);
        uint32_t hash = 2166136261u; 
        
        for (char c : input) {
            hash ^= static_cast<uint8_t>(c);
            hash *= 16777619u;
        }
        
        for(int i = 0; i < 500; i++) {
            hash ^= static_cast<uint32_t>(i);
            hash *= 16777619u;
        }

        if ((hash & mask) == 0) {
            return 1; // Valid
        }
        return 0; // Invalid
    }
}