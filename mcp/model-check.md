# LM Studio のモデルでの確認の記録

`python mcp/test_client.py --lmstudio モデル名` の結果を書き足しています。test_client が AIアプリの代わりになり、LM Studio のモデルが選んだ道具を、このMCPサーバーで実行しました。

## 2026-11-05 17:41

- MCPサーバー：直す前（文字で送られた一覧と、数でない cursor を受け付けていなかった版）
- 環境：Windows 11、メモリ 15.7GB、11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz
- LM Studio：アプリ 0.4.21+2、lms CLI commit: 71bd99c

| モデル | 課題 | 結果 | 時間 | 呼んだ道具 | 返事（先頭）／失敗のときの道具の返事 |
|---|---|---|---|---|---|
| lmstudio-community/llama-3.2-3b-instruct | 点検して件数を答える | 成功 | 19秒 | check_sheet、check_sheet | 答えは0です。 |
| lmstudio-community/llama-3.2-3b-instruct | 項目を1件書き込む | 失敗 | 68秒 | write_items、write_items、write_items、write_items、write_items、write_items |  ／ 道具の返事：できませんでした：items と delete は一覧（配列）にしてください |
| lmstudio-community/llama-3.2-3b-instruct | 区切られた項目を読んで答える | 失敗 | 61秒 | read_items、read_items、check_sheet、check_sheet、write_items、write_items |  ／ 道具の返事：思わぬ問題が起きました：ValueError |
| qwen3.5-4b | 点検して件数を答える | 成功 | 64秒 | check_sheet | 要件定義（yoken）の工程票を点検した結果、**要対応 0件**です。 |
| qwen3.5-4b | 項目を1件書き込む | 成功 | 58秒 | write_items | R-01 |
| qwen3.5-4b | 区切られた項目を読んで答える | 成功 | 177秒 | get_guide、get_guide、list_cases、read_items | 詳細設計（shosai）工程票の判定の決まり DR-01 に基づくと、**1 年〜3 年の児童には 3 点**を加点します。 |

## 2026-11-05 18:00

- MCPサーバー：直した後（文字で送られた一覧を読み、数でない cursor には理由を返す版）
- 環境：Windows 11、メモリ 15.7GB、11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz
- LM Studio：アプリ 0.4.21+2、lms CLI commit: 71bd99c

| モデル | 課題 | 結果 | 時間 | 呼んだ道具 | 返事（先頭）／失敗のときの道具の返事 |
|---|---|---|---|---|---|
| lmstudio-community/llama-3.2-3b-instruct | 点検して件数を答える | 成功 | 18秒 | check_sheet、check_sheet | 答えは0です。 |
| lmstudio-community/llama-3.2-3b-instruct | 項目を1件書き込む | 失敗 | 75秒 | write_items、write_items、write_items、write_items、write_items、write_items |  ／ 道具の返事：書き込みませんでした（1件でも誤りがあると、すべて書き込みません）： - 1件目：section は genjo・komari・mokuteki・kino・taishogai のどれかにしてください |
| lmstudio-community/llama-3.2-3b-instruct | 区切られた項目を読んで答える | 失敗 | 44秒 | read_items、read_items、get_guide、check_sheet、check_sheet、get_guide |  ／ 道具の返事：できませんでした：cursor は数にしてください（受け取った値："null"）。前の返事の「cursor=数」の数を付けるか、初めから読むときは付けないでください |
| qwen3.5-4b | 点検して件数を答える | 成功 | 54秒 | check_sheet | 要件定義（yoken）の工程票を点検した結果、**要対応 0件**です。 |
| qwen3.5-4b | 項目を1件書き込む | 成功 | 55秒 | write_items | R-01 |
| qwen3.5-4b | 区切られた項目を読んで答える | 成功 | 217秒 | get_guide、get_guide、list_cases、get_overview、read_items | 詳細設計（shosai）工程票の判定の決まり DR-01 に基づくと、**1 年〜3 年の児童には 3 点**を加えます。 |

