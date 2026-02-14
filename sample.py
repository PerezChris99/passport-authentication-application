
rows = 4 

for current_row in range(1, rows + 1):

    spaces = " " * (rows - current_row) * 2
    print(spaces, end="")

    if current_row == 1:
        print("*")  
    else:
        middle_section = "8" * (2 * current_row - 3)
        print(f"*{middle_section}*")  

base_alignment = " " * (rows - 1) * 2
print(f"{base_alignment}|")
