// cpp/core.cpp
#include <emscripten.h>
#include <string>

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
}