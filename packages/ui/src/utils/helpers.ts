export const generateRandomString = (length: number): string => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const charactersLength = chars.length;

  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * charactersLength));
  }

  return result;
};

export const formatFollowerCount = (count: number): string => {
  if (count >= 1000000) {
    const millions = count / 1000000;
    return millions % 1 === 0
      ? `${Math.floor(millions)}M`
      : `${millions.toFixed(1)}M`;
  }
  return count.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};
