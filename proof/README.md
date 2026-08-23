# 证明复现

本目录保留 v6 Python 证明程序和可直接上传 Google Colab 的笔记本。完整证明验证：

```bash
python -m pip install numpy numba
python prove_first_player.py
```

证明固定先手第 1 手在格 1，并对对手第 1 手的 20 种落点逐一寻找统一的第 2 手；之后继续验证全部第 2、3 手回应，最后从第 4 手后的局面精确搜索到终局。

程序内部用负数存先手、正数存后手。终局差值是“后手邻和 − 先手邻和”：正数代表先手邻和更小，因此先手获胜。
