def calculate_total(values):
    return sum(values)


if __name__ == "__main__":
    assert calculate_total([12, 18, 6]) == 36
    print(calculate_total([12, 18, 6]))
